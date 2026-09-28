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
      YAML: function handleYamlDirective(state, name, args2) {
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args2.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        const match = /^([0-9]+)\.([0-9]+)$/.exec(args2[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args2[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args2) {
        let prefix;
        if (args2.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        const handle = args2[0];
        prefix = args2[1];
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

// scripts/feedback-triage.ts
var feedback_triage_exports = {};
__export(feedback_triage_exports, {
  FILED_SCHEMA: () => FILED_SCHEMA,
  SAFE_ID_RE: () => SAFE_ID_RE,
  TRIAGE_SCHEMA: () => TRIAGE_SCHEMA,
  assertSafeId: () => assertSafeId,
  feedbackDir: () => feedbackDir,
  runFile: () => runFile,
  runTriage: () => runTriage
});
module.exports = __toCommonJS(feedback_triage_exports);
var fs5 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var import_child_process = require("child_process");

// scripts/lib/replay-rundir.ts
var fsNode = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// scripts/lib/state/ensure-storage-layout.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      try {
        if (fs.existsSync(guildDir) && fs.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path2.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs2.existsSync(path2.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs2.readFileSync(marker, "utf8"));
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
      path2.join(__dirname, "upgrade-chain.js"),
      path2.join(__dirname, "lib", "state", "upgrade-chain"),
      path2.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs2.existsSync(c) || fs2.existsSync(`${c}.ts`)) ?? candidates[2];
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

// scripts/lib/replay-rundir.ts
function createRealReplayFsSeam() {
  return {
    exists(absPath) {
      return fsNode.existsSync(absPath);
    },
    listDir(absPath) {
      try {
        return fsNode.readdirSync(absPath, { withFileTypes: false });
      } catch {
        return [];
      }
    }
  };
}
var ARTIFACT_CATALOGUE = [
  // ── Required shipped ──────────────────────────────────────────────────────
  {
    role: "events",
    relativePath: "logs/v1.4-events.jsonl",
    required: true,
    status: "shipped"
  },
  {
    role: "provenance",
    relativePath: "provenance.json",
    required: true,
    status: "shipped"
  },
  {
    role: "run-manifest",
    relativePath: "run.yaml",
    required: true,
    status: "shipped"
  },
  // ── Shipped — present/missing noted but not required ─────────────────────
  {
    role: "events-legacy",
    relativePath: "events.ndjson",
    required: false,
    status: "shipped"
  },
  {
    role: "handoffs",
    relativePath: "handoffs",
    required: false,
    status: "shipped",
    isDir: true
  },
  {
    role: "payloads",
    relativePath: "logs/payloads",
    required: false,
    status: "shipped",
    isDir: true
  },
  {
    role: "review",
    relativePath: "review.md",
    required: false,
    status: "shipped"
  },
  {
    role: "verify",
    relativePath: "verify.md",
    required: false,
    status: "shipped"
  },
  {
    role: "summary",
    relativePath: "summary.md",
    required: false,
    status: "shipped"
  },
  // ── Deferred [v2.x] — never required; listed for completeness reporting ──
  {
    role: "timeline",
    relativePath: "timeline.jsonl",
    required: false,
    status: "deferred"
  },
  {
    role: "context-refs",
    relativePath: "context-refs.json",
    required: false,
    status: "deferred"
  },
  {
    role: "evidence",
    relativePath: "evidence",
    required: false,
    status: "deferred",
    isDir: true
  },
  {
    role: "assumptions",
    relativePath: "assumptions.md",
    required: false,
    status: "deferred"
  },
  {
    role: "decisions",
    relativePath: "decisions.md",
    required: false,
    status: "deferred"
  }
];
function assembleReplayManifest(runDir, opts) {
  const fs6 = opts?.fs ?? createRealReplayFsSeam();
  const artifacts = ARTIFACT_CATALOGUE.map((def) => {
    const absPath = path3.join(runDir, def.relativePath);
    const present = fs6.exists(absPath);
    const entry = {
      role: def.role,
      relativePath: def.relativePath,
      present,
      required: def.required,
      status: def.status
    };
    if (def.isDir) {
      entry.files = present ? fs6.listDir(absPath) : [];
    }
    return entry;
  });
  const complete = artifacts.filter((a) => a.required).every((a) => a.present);
  return {
    schema_version: "guild.replay_manifest.v1",
    runDir,
    artifacts,
    complete
  };
}
if (require.main === module && /^replay-rundir\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const argv = process.argv.slice(2);
  const runDir = argv[0];
  if (!runDir) {
    process.stderr.write("Usage: npx tsx scripts/lib/replay-rundir.ts <runDir>\n");
    process.exit(1);
  }
  const absRunDir = path3.resolve(runDir);
  const manifest = assembleReplayManifest(absRunDir);
  const ts = new Date(Date.now()).toISOString();
  process.stdout.write(
    JSON.stringify({ ts, ...manifest }, null, 2) + "\n"
  );
  process.exit(manifest.complete ? 0 : 1);
}

// scripts/docs-hygiene/scan.ts
var fs4 = __toESM(require("fs"));
var path6 = __toESM(require("path"));

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
var path5 = __toESM(require("node:path"));

// src/domains/kernel/plugin-root.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path4.join("runtime", "guild-mcp.js");
function findPluginRoot(fromDir) {
  let dir = path4.resolve(fromDir);
  for (; ; ) {
    if (fs3.existsSync(path4.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path4.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// src/domains/kernel/yaml-loader.ts
function pluginLocalScriptsRoots() {
  const own = findPluginRoot(__dirname);
  return [
    // The package this code shipped in, whatever the bundle depth (runtime/scripts).
    ...own === null ? [] : [path5.join(own, "scripts")],
    // Source TS layout (src/domains/<id>) and the bundled agent-team hook layout
    // (hooks/agent-team/dist) both sit three levels under plugin/.
    path5.resolve(__dirname, "..", "..", "..", "scripts"),
    // Bundled hook layout (hooks/dist) and src/adapters both sit two levels under.
    path5.resolve(__dirname, "..", "..", "scripts"),
    // src/adapters/model-discovery and any deeper nesting.
    path5.resolve(__dirname, "..", "..", "..", "..", "scripts")
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
  const cwdRoot = path5.resolve(process.cwd(), "scripts");
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

// src/domains/state/frontmatter.ts
var loadedYaml = null;
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}
var OPEN_FENCE = /^---[ \t]*\r?\n/;
var CLOSE_FENCE = /\r?\n---[ \t]*(?:\r?\n|$)/;
function splitFrontmatter(content) {
  if (!OPEN_FENCE.test(content)) return { frontmatter: null, body: content };
  const firstNl = content.indexOf("\n");
  const rest = content.slice(firstNl + 1);
  const close = CLOSE_FENCE.exec(rest);
  if (!close) return { frontmatter: null, body: content };
  const frontmatter = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  return { frontmatter, body };
}
function parseYaml(text, opts = {}) {
  try {
    const yaml = yamlApi();
    const value = yaml.load(text, { schema: opts.schema ?? yaml.JSON_SCHEMA });
    return value === void 0 ? null : value;
  } catch {
    return null;
  }
}
function parseFrontmatter(content, opts = {}) {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null || frontmatter.trim() === "") return null;
  const value = parseYaml(frontmatter, opts);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value;
}

// scripts/lib/frontmatter.ts
var parseFrontmatter2 = parseFrontmatter;

// src/domains/security/secret-patterns.ts
var SECRET_PATTERNS = Object.freeze([
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

// scripts/docs-hygiene/scan.ts
var args = process.argv.slice(2);
var workspaceArg = args.find((a) => a.startsWith("--workspace="));
var WORKSPACE = workspaceArg ? workspaceArg.split("=")[1] : path6.resolve(__dirname, "../../..");
var DOCS_KNOWLEDGE = path6.join(WORKSPACE, "docs/knowledge");
var UMBRELLA_WIKI = path6.join(WORKSPACE, ".guild/wiki");
var PLUGIN_WIKI = path6.join(WORKSPACE, "plugin/.guild/wiki");
var PLUGIN_DOCS = path6.join(WORKSPACE, "plugin/docs");
var MIGRATION_MD = path6.join(WORKSPACE, "MIGRATION.md");
var AGENTS_MD = path6.join(WORKSPACE, "AGENTS.md");
var ROOT_README = path6.join(WORKSPACE, "README.md");
var PLUGIN_README = path6.join(WORKSPACE, "plugin/README.md");
var PLUGIN_CLAUDE = path6.join(WORKSPACE, "plugin/CLAUDE.md");
var outputArg = args.find((a) => a.startsWith("--output="));
var OUTPUT_PATH = outputArg ? path6.resolve(outputArg.split("=")[1]) : path6.resolve(__dirname, ".last-scan.md");
var OUTPUT_DIR = path6.dirname(OUTPUT_PATH);
var LANDING_FILE_NAMES = /* @__PURE__ */ new Set([
  "README.md",
  "index.md",
  "QUERY.md",
  "TRANSFER-MANIFEST.md",
  "MIGRATION.md"
]);
function relPath(p) {
  return p.startsWith(WORKSPACE) ? p.slice(WORKSPACE.length + 1) : p;
}
function walkFiles(dir, filter = /\.md$/) {
  if (!fs4.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs4.readdirSync(dir, { withFileTypes: true })) {
    const full = path6.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === "_archive") continue;
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, filter));
    } else if (entry.isFile() && filter.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}
function readFile(p) {
  try {
    return fs4.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function parseFrontmatter3(content) {
  const obj = parseFrontmatter2(content);
  if (obj === null) return null;
  const fm = {};
  for (const [k, v] of Object.entries(obj)) {
    fm[k] = v === null || v === void 0 ? "" : String(v);
  }
  return fm;
}
var flags = [];
function addFlag(f) {
  flags.push(f);
}
var DRIFT_PATTERNS = [
  // v1 command prefix in user-visible text (not in quoted code that's documenting v1→v2 migration)
  [/\/guild-(?:wiki|init|ideate|plan|build|qa|ops|evolve|rollback|stats|audit|fix|status|resume|config|initiative|learn)\b/, "v1 /guild-* command reference"],
  // Single-repo assumption: assuming plugin/ IS the entire repo
  [/\bsingle.?repo\b/i, "single-repo assumption"],
  // Pre-v2 path assumptions (commands/guild-*.md references outside provenance docs)
  [/commands\/guild-(?:wiki|evolve|rollback|stats|audit|init|plan|ideate|build|ops|qa|fix|status|resume|config|initiative|learn)\.md/, "v1 commands/ file path"]
];
function isSupersessionBookkeeping(line) {
  const t = line.trim();
  if (/^(?:supersedes):\s/.test(t)) return true;
  if (/^(?:source_refs):\s/.test(t)) return true;
  if (/^\s*-\s+/.test(t) && /supersedes|source_refs/.test(t)) return true;
  if (/\bsupersedes\b/.test(t)) return true;
  return false;
}
function isWorkspaceAwareLine(line) {
  const t = line.trim();
  if (/\bis_workspace\b/i.test(t)) return true;
  if (/\bworkspace\b/i.test(t)) return true;
  return false;
}
var LINEAGE_MARKERS = [
  /\bfrozen v1\b/i,
  /\bv1 record\b/i,
  /\bv1 name:\s*/i,
  /\bv1 path\b/i,
  /\bv1 7-step\b/i,
  /\bv2 note:/i,
  /\bbanner only\b/i,
  /\bv1[→>-]v2\b/i,
  /\bsuperseded by\b/i,
  /\bfrozen as\b/i,
  /\b(?:is|are|stays?) frozen\b/i,
  /architecture-draft record/i
];
function isExplicitLineageReference(line) {
  const t = line.trim();
  return LINEAGE_MARKERS.some((m) => m.test(t));
}
function hasLineagePrior(contentLines, idx, lookback = 3) {
  for (let k = Math.max(0, idx - lookback); k < idx; k++) {
    if (isExplicitLineageReference(contentLines[k])) return true;
  }
  return false;
}
function isFrozenV1Doc(content) {
  const lines = content.split("\n");
  let i = 0;
  if (lines[0]?.slice(0, 3) === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  const head = lines.slice(i, i + 60).join("\n");
  if (/\bv2 note:/i.test(head)) return true;
  if (/\bfrozen v1 record\b/i.test(head)) return true;
  if (/\barchitecture-draft record\b/i.test(head)) return true;
  return false;
}
function isProvenanceDoc(rel) {
  if (rel.includes("/research/") || rel.includes("/ideation/")) return true;
  if (rel.includes("implementation/phases/")) return true;
  if (rel.includes("plugin/docs/superpowers/")) return true;
  if (rel.includes("plugin/docs/phase-gates/")) return true;
  if (rel.includes("plugin/docs/audit/")) return true;
  return false;
}
function scanDrift(corpus, excludeResearch = true) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (isProvenanceDoc(rel)) continue;
    if (excludeResearch && (rel.includes("/research/") || rel.includes("/ideation/"))) continue;
    const content = readFile(fpath);
    if (isFrozenV1Doc(content)) continue;
    const contentLines = content.split("\n");
    let inFrontmatter = false;
    let fmEnded = false;
    if (content.slice(0, 3) === "---") {
      inFrontmatter = true;
    }
    let fmEndLine = -1;
    for (let i = 1; i < contentLines.length; i++) {
      if (inFrontmatter && contentLines[i].trim() === "---") {
        fmEndLine = i;
        inFrontmatter = false;
        fmEnded = true;
        break;
      }
    }
    for (const [pattern, label] of DRIFT_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        const lineIdx = i;
        if (fmEnded && lineIdx <= fmEndLine) continue;
        if (!fmEnded && inFrontmatter) continue;
        const line = contentLines[i];
        if (!pattern.test(line)) continue;
        if (isSupersessionBookkeeping(line)) continue;
        if (isExplicitLineageReference(line)) continue;
        if (hasLineagePrior(contentLines, i, 3)) continue;
        if (label === "single-repo assumption" && isWorkspaceAwareLine(line)) continue;
        addFlag({
          category: "drift",
          file: rel,
          lines: `L${i + 1}`,
          pattern: label,
          match: line.trim().slice(0, 120)
        });
      }
    }
  }
}
function hasProgressCoOccurrence(line) {
  if (/\b20\d\d-\d\d(-\d\d)?\b/.test(line)) return true;
  if (/\b(TODO|WIP)\b/.test(line)) return true;
  if (/\b(we then|previously we|we did|then we|after that|next batch|coming next)\b/i.test(line)) return true;
  if (/\b(Wave-?\d+|Sprint\s+\d+)\b.{0,50}\b(done|complete|finished|started|in progress|blocked|shipped)\b/i.test(line)) return true;
  if (/\bin this (wave|sprint|session|initiative)\b/i.test(line)) return true;
  return false;
}
var PROGRESS_PATTERNS = [
  // C.3-pattern-1: phase/session status narrative — only flagged with co-occurrence signal
  [/\b(as of|we then|previously we|coming next|next batch)\b/i, "C.3-pattern-1: session/changelog narrative (strong signal)"],
  // C.3-pattern-2: progress emoji — only flagged with co-occurrence (❌/✅/🚧 are used in architecture tables too)
  [/[✅🚧⬜]/, "C.3-pattern-2: progress emoji (verify: task-board vs architecture table)"],
  // C.3-pattern-3: wave/phase/gate — ONLY if accompanied by a session-status signal (not bare architectural vocab)
  [/\bWave-?\d+\b/, "C.3-pattern-3: wave ordinal \u2014 check if sprint-status or architectural reference"]
];
function scanProgressMsg(corpus) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    if (isProvenanceDoc(rel)) continue;
    const bname = path6.basename(fpath);
    if (LANDING_FILE_NAMES.has(bname)) continue;
    const content = readFile(fpath);
    const contentLines = content.split("\n");
    let fmEndLine = -1;
    if (content.slice(0, 3) === "---") {
      for (let i = 1; i < contentLines.length; i++) {
        if (contentLines[i].trim() === "---") {
          fmEndLine = i;
          break;
        }
      }
    }
    const bnameLower = bname.toLowerCase();
    if (bnameLower.includes("roadmap")) continue;
    for (const [pattern, label] of PROGRESS_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        if (fmEndLine >= 0 && i <= fmEndLine) continue;
        const line = contentLines[i];
        if (!pattern.test(line)) continue;
        const trimmed = line.trim();
        if (rel.includes("knowledge-base-hygiene-and-grading")) continue;
        if (trimmed.startsWith("```") || trimmed.startsWith("    ")) continue;
        if (/\bAccepted\s*\(/.test(line)) continue;
        if (/\boperator-ratified\b/i.test(line)) continue;
        if (/\bratified\s+20\d\d/i.test(line)) continue;
        if (/`[0-9a-f]{7,12}`\s*\([^)]*Wave-?\d+/.test(line)) continue;
        const isWeakPattern = label.includes("C.3-pattern-2") || label.includes("C.3-pattern-3");
        if (isWeakPattern && !hasProgressCoOccurrence(line)) continue;
        if (label.includes("C.3-pattern-1")) {
        }
        addFlag({
          category: "progress-msg",
          file: rel,
          lines: `L${i + 1}`,
          pattern: label,
          match: trimmed.slice(0, 120)
        });
      }
    }
  }
}
function buildSlugSet() {
  const slugs = /* @__PURE__ */ new Set();
  for (const fpath of [
    ...walkFiles(DOCS_KNOWLEDGE),
    ...walkFiles(UMBRELLA_WIKI),
    ...walkFiles(PLUGIN_WIKI)
  ]) {
    const slug = path6.basename(fpath, ".md");
    slugs.add(slug);
  }
  return slugs;
}
function scanDanglingRelated(corpus, slugSet) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const contentLines = content.split("\n");
    if (content.slice(0, 3) !== "---") continue;
    const fmEnd = content.indexOf("---", 3);
    if (fmEnd < 0) continue;
    const fmLines = content.slice(3, fmEnd).split("\n");
    let inRelated = false;
    let startLineOffset = 1;
    let fmLineIdx = 0;
    for (const fmLine of fmLines) {
      fmLineIdx++;
      const fileLineNo = fmLineIdx + 1;
      if (fmLine.startsWith("related:")) {
        inRelated = true;
        const inlineMatch = fmLine.match(/:\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          for (const s of inlineMatch[1].split(",")) {
            const t = s.trim().replace(/#.*$/, "").trim();
            if (t && t !== "<slugs>" && !slugSet.has(t)) {
              addFlag({
                category: "dangling-related",
                file: rel,
                lines: `L${fileLineNo}`,
                pattern: "related: slug not found as page",
                match: `related slug: ${t}`
              });
            }
          }
          inRelated = false;
        }
        continue;
      }
      if (inRelated) {
        if (fmLine.startsWith("  ") || fmLine.startsWith("	")) {
          const m = fmLine.match(/^\s+-\s+(.+)/);
          if (m) {
            const t = m[1].trim().replace(/#.*$/, "").trim();
            if (t && t !== "<slugs>" && !slugSet.has(t)) {
              addFlag({
                category: "dangling-related",
                file: rel,
                lines: `L${fileLineNo}`,
                pattern: "related: slug not found as page",
                match: `related slug: ${t}`
              });
            }
          }
        } else {
          inRelated = false;
        }
      }
    }
  }
}
function scanDanglingSourceRefs(corpus) {
  const pathLike = /^[./]|\/|\.(md|ts|js|json|yaml|yml)($|\s)/;
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    if (content.slice(0, 3) !== "---") continue;
    const fmEnd = content.indexOf("---", 3);
    if (fmEnd < 0) continue;
    const fmText = content.slice(3, fmEnd);
    const fmLines = fmText.split("\n");
    let inSourceRefs = false;
    let fmLineIdx = 0;
    for (const fmLine of fmLines) {
      fmLineIdx++;
      const fileLineNo = fmLineIdx + 1;
      if (fmLine.startsWith("source_refs:")) {
        inSourceRefs = true;
        const inlineMatch = fmLine.match(/:\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          for (const s of inlineMatch[1].split(",")) {
            const t = s.trim().replace(/"'/g, "").replace(/#.*$/, "").trim();
            checkSourceRef(t, rel, `L${fileLineNo}`);
          }
          inSourceRefs = false;
        }
        continue;
      }
      if (inSourceRefs) {
        if (fmLine.startsWith("  ") || fmLine.startsWith("	")) {
          const m = fmLine.match(/^\s+-\s+"?([^"#\n]+)"?\s*(?:#.*)?$/);
          if (m) {
            const t = m[1].trim();
            if (pathLike.test(t)) {
              checkSourceRef(t, rel, `L${fileLineNo}`);
            }
          }
        } else if (!fmLine.match(/^\s*$/)) {
          inSourceRefs = false;
        }
      }
    }
  }
}
function checkSourceRef(ref, sourceFile, lineLabel) {
  if (!ref || ref === "[]" || ref === "null") return;
  const clean = ref.replace(/#.*$/, "").trim().replace(/^["']|["']$/g, "");
  if (!clean || !clean.includes("/")) return;
  if (clean.startsWith(".guild/") && !clean.startsWith(".guild/wiki/")) return;
  if (clean.includes("/.guild/") && !clean.includes("/.guild/wiki/")) return;
  let checkPath;
  if (clean.startsWith("/")) {
    checkPath = clean;
  } else if (clean.startsWith("docs/") || clean.startsWith("plugin/") || clean.startsWith("benchmark/") || clean.startsWith("mcp-servers/") || clean.startsWith("website/") || clean.startsWith("scripts/") || clean.startsWith("hooks/")) {
    checkPath = path6.join(WORKSPACE, clean);
  } else if (clean.startsWith("external-input/")) {
    return;
  } else {
    checkPath = path6.join(WORKSPACE, path6.dirname(sourceFile), clean);
  }
  const withoutSection = checkPath.split(" ")[0];
  if (!fs4.existsSync(withoutSection)) {
    addFlag({
      category: "dangling-source-refs",
      file: sourceFile,
      lines: lineLabel,
      pattern: "source_refs: path not found on disk",
      match: `source_ref: ${clean.slice(0, 100)}`
    });
  }
}
function isCanonicalPage(fpath) {
  const rel = relPath(fpath);
  if (!rel.startsWith("docs/knowledge/") && !rel.includes(".guild/wiki/")) return false;
  if (rel.includes("/_archive/")) return false;
  if (rel.includes("/research/")) return false;
  if (rel.includes("/ideation/")) return false;
  const bname = path6.basename(fpath);
  if (LANDING_FILE_NAMES.has(bname)) return false;
  return true;
}
function scanMissingImportance(corpus) {
  for (const fpath of corpus) {
    if (!isCanonicalPage(fpath)) continue;
    const content = readFile(fpath);
    const fm = parseFrontmatter3(content);
    if (!fm) {
      addFlag({
        category: "missing-importance",
        file: relPath(fpath),
        lines: "L1",
        pattern: "canonical page has no frontmatter",
        match: path6.basename(fpath)
      });
      continue;
    }
    if (!fm["importance"]) {
      addFlag({
        category: "missing-importance",
        file: relPath(fpath),
        lines: "L1",
        pattern: "importance: field absent on canonical page",
        match: `type:${fm["type"] || "??"} confidence:${fm["confidence"] || "??"}`
      });
    } else {
      const valid = ["critical", "high", "medium", "low"];
      if (!valid.includes(fm["importance"])) {
        addFlag({
          category: "missing-importance",
          file: relPath(fpath),
          lines: "L1",
          pattern: "importance: value not in enum (critical|high|medium|low)",
          match: `importance: ${fm["importance"]}`
        });
      }
    }
  }
}
function scanPendingGradeReview(corpus) {
  for (const fpath of corpus) {
    const content = readFile(fpath);
    const fm = parseFrontmatter3(content);
    if (!fm) continue;
    if (fm["importance_draft"] === "true") {
      addFlag({
        category: "pending-grade-review",
        file: relPath(fpath),
        lines: "L1",
        pattern: "importance_draft: true \u2014 migration-drafted grade awaiting operator review",
        match: `importance: ${fm["importance"] || "??"} graded_by: ${fm["graded_by"] || "??"}`
      });
    }
  }
}
function scanSecrets(corpus) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    const content = readFile(fpath);
    const contentLines = content.split("\n");
    for (const [pattern, label] of SECRET_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        if (pattern.test(contentLines[i])) {
          if (label === "high-entropy hex string (potential secret)") {
            const line = contentLines[i];
            if (/\b(commit|sha|HEAD|merge|tag|heads?)\b/i.test(line)) continue;
            if (line.trim().startsWith("```") || line.trim().startsWith("#")) continue;
          }
          addFlag({
            category: "secrets",
            file: rel,
            lines: `L${i + 1}`,
            pattern: label,
            match: contentLines[i].trim().slice(0, 80).replace(/[^\x20-\x7E]/g, "?")
          });
        }
      }
    }
  }
}
if (require.main === module && /^scan\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  let renderSection = function(category, title) {
    const section = flags.filter((f) => f.category === category);
    if (section.length === 0) return `
## ${title}

No findings.
`;
    let out = `
## ${title} (${section.length} flags)

`;
    out += "| File | Lines | Pattern | Match |\n";
    out += "|---|---|---|---|\n";
    for (const f of section) {
      const matchSafe = f.match.replace(/\|/g, "\\|");
      out += `| \`${f.file}\` | ${f.lines} | ${f.pattern} | \`${matchSafe}\` |
`;
    }
    return out;
  };
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const docsKnowledgeFiles = walkFiles(DOCS_KNOWLEDGE);
  const umbrellaWikiFiles = walkFiles(UMBRELLA_WIKI);
  const pluginWikiFiles = walkFiles(PLUGIN_WIKI);
  const pluginDocsFiles = walkFiles(PLUGIN_DOCS);
  const rootFiles = [MIGRATION_MD, AGENTS_MD, ROOT_README, PLUGIN_README, PLUGIN_CLAUDE].filter(
    fs4.existsSync
  );
  const allCorpus = [
    ...docsKnowledgeFiles,
    ...umbrellaWikiFiles,
    ...pluginWikiFiles,
    ...pluginDocsFiles,
    ...rootFiles
  ];
  const canonicalCorpus = [...docsKnowledgeFiles, ...umbrellaWikiFiles].filter(
    (f) => isCanonicalPage(f)
  );
  console.error("Running drift scan...");
  scanDrift(allCorpus, false);
  console.error("Running progress-messaging scan...");
  scanProgressMsg(allCorpus);
  console.error("Building slug set...");
  const slugSet = buildSlugSet();
  console.error("Running dangling-related scan...");
  scanDanglingRelated(allCorpus, slugSet);
  console.error("Running dangling-source-refs scan...");
  scanDanglingSourceRefs(allCorpus);
  console.error("Running missing-importance scan...");
  scanMissingImportance(canonicalCorpus);
  console.error("Running secrets scan...");
  scanSecrets(allCorpus);
  console.error("Running pending-grade-review scan...");
  scanPendingGradeReview(allCorpus);
  const counts = {
    drift: 0,
    "progress-msg": 0,
    "dangling-related": 0,
    "dangling-source-refs": 0,
    "missing-importance": 0,
    secrets: 0,
    "pending-grade-review": 0
  };
  for (const f of flags) counts[f.category]++;
  const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const totalFlags = flags.length;
  let output = `---
type: artifact
initiative: docs-clean-up
task: D-build
owner: eval-engineer
created_at: ${now}
---

# Scan flag list \u2014 docs-clean-up hygiene scan

Generated by \`plugin/scripts/docs-hygiene/scan.ts\` on ${now}.
Lane C consumes this as its worklist. **Flags are candidates, not auto-deletes** \u2014 Lane C reviews each against the ADR rules (see \`ADR: knowledge-base-hygiene-and-grading (workspace wiki)\`).

## Summary

| Category | Count |
|---|---|
| Drift markers (v1/single-repo) | ${counts["drift"]} |
| Progress messaging (C.3 patterns) | ${counts["progress-msg"]} |
| Dangling related: slugs | ${counts["dangling-related"]} |
| Dangling source_refs: paths | ${counts["dangling-source-refs"]} |
| Missing importance: on canonical page | ${counts["missing-importance"]} |
| Secrets grep | ${counts["secrets"]} |
| Pending grade review (importance_draft) | ${counts["pending-grade-review"]} |
| **Total** | **${totalFlags}** |

`;
  output += renderSection("drift", "1. Drift markers (v1/single-repo)");
  output += renderSection("progress-msg", "2. Progress messaging (C.3 patterns)");
  output += renderSection("dangling-related", "3. Dangling related: slugs");
  output += renderSection("dangling-source-refs", "4. Dangling source_refs: paths");
  output += renderSection("missing-importance", "5. Missing importance: on canonical pages");
  output += renderSection("secrets", "6. Secrets grep");
  output += renderSection("pending-grade-review", "7. Pending grade review (migration draft grades)");
  output += `
---

## How to use this list

1. For each **drift** flag: replace the v1 reference with its v2 equivalent per \`MIGRATION.md\`.
2. For each **progress-msg** flag: apply the C.2 keep-vs-delete test; DELETE outright if it is status/session narrative; KEEP if it is load-bearing rationale. **Escalate borderline cases to the gate.**
3. For each **dangling-related** flag: either correct the slug to match an existing page, or remove the stale entry.
4. For each **dangling-source-refs** flag: verify the path is still at the declared location; correct or remove.
5. For each **missing-importance** flag: apply the A.2 level definitions to assign \`importance: critical|high|medium|low\`. Marquee features default to \`critical\`.
6. For each **secrets** flag: investigate; if genuine secret, rotate + remove immediately.
7. For each **pending-grade-review** flag: the page carries a migration-drafted \`importance:\` grade (\`importance_draft: true\`). Review/edit the grade, then accept with \`npx tsx plugin/scripts/dot-guild/migrate-guild.ts --accept-grades --root=<repo>\` (see \`MIGRATION.md\`).

---

_Run: \`npx tsx plugin/scripts/docs-hygiene/scan.ts\` from the workspace root._
`;
  fs4.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs4.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(OUTPUT_PATH);
  console.error(`
Scan complete \u2014 ${totalFlags} total flags written to ${OUTPUT_PATH}`);
  console.error(`  drift:             ${counts["drift"]}`);
  console.error(`  progress-msg:      ${counts["progress-msg"]}`);
  console.error(`  dangling-related:  ${counts["dangling-related"]}`);
  console.error(`  dangling-source-refs: ${counts["dangling-source-refs"]}`);
  console.error(`  missing-importance: ${counts["missing-importance"]}`);
  console.error(`  secrets:           ${counts["secrets"]}`);
  console.error(`  pending-grade-review: ${counts["pending-grade-review"]}`);
}

// scripts/lib/sanitized-run-export.ts
function addHit(acc, kind, count) {
  if (count <= 0) return;
  acc.hits.set(kind, (acc.hits.get(kind) ?? 0) + count);
}
function replaceAndCount(input, re, replacement, kind, acc) {
  let count = 0;
  const out = input.replace(re, () => {
    count++;
    return replacement;
  });
  addHit(acc, kind, count);
  return out;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function redactRunString(input, policy = {}, acc = { hits: /* @__PURE__ */ new Map() }) {
  let out = input;
  out = replaceAndCount(out, /(?:\/Users\/|\/home\/)[^"'\s]+/g, "<redacted:private-path>", "private-path", acc);
  out = replaceAndCount(out, /\b[A-Za-z]:\\Users\\[^"'\s]+/g, "<redacted:private-path>", "private-path", acc);
  for (const secret of policy.configuredSecrets ?? []) {
    if (!secret) continue;
    out = replaceAndCount(out, new RegExp(escapeRegExp(secret), "g"), "<redacted:configured-secret>", "configured-secret", acc);
  }
  for (const prefix of policy.privatePathPrefixes ?? []) {
    if (!prefix) continue;
    out = replaceAndCount(out, new RegExp(`${escapeRegExp(prefix)}[^\\s"']*`, "g"), "<redacted:private-path>", "private-path", acc);
  }
  for (const pattern of policy.customPatterns ?? []) {
    try {
      out = replaceAndCount(out, new RegExp(pattern, "g"), "<redacted:custom-pattern>", "custom-pattern", acc);
    } catch {
    }
  }
  out = replaceAndCount(out, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted:private-key>", "private-key", acc);
  out = replaceAndCount(out, /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer <redacted:auth-header>", "auth-header", acc);
  out = replaceAndCount(out, /\bCookie\s*:\s*[^"\n\r]+/gi, "Cookie: <redacted:cookie>", "cookie", acc);
  out = replaceAndCount(out, /\bsk-[A-Za-z0-9_-]{16,}\b/g, "<redacted:api-key>", "api-key", acc);
  out = replaceAndCount(out, /\bsk_live_[A-Za-z0-9]{12,}\b/g, "<redacted:api-key>", "api-key", acc);
  out = replaceAndCount(out, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(?:ghp|ghs|xox[baprs])_[A-Za-z0-9-]{12,}/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\bya29\.[A-Za-z0-9._-]{12,}/g, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(password|passwd|pwd)\s*[:=]\s*([^\s"',}]+)/gi, "<redacted:password>", "password", acc);
  out = replaceAndCount(out, /\b(token|access_token|refresh_token|id_token)\s*[:=]\s*([^\s"',}]+)/gi, "<redacted:token>", "token", acc);
  out = replaceAndCount(out, /\b(?:\d[ -]*?){13,19}\b/g, "<redacted:payment-card>", "payment-card", acc);
  out = replaceAndCount(out, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted:email>", "email", acc);
  out = replaceAndCount(out, /\b(cus|customer|user|usr)_[A-Za-z0-9]{6,}\b/g, "<redacted:customer-id>", "customer-id", acc);
  for (const [re, label] of SECRET_PATTERNS) {
    const flags2 = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    out = replaceAndCount(out, new RegExp(re.source, flags2), `<redacted:${label}>`, "canonical-secret", acc);
  }
  return out;
}

// scripts/lib/run-learning-classifier.ts
var RUN_LEARNING_CLASSIFIER_SCHEMA = "guild.run_learning_classification.v1";
var GITHUB_ISSUE_DRAFT_SCHEMA = "guild.github_issue_draft.v1";
var GITHUB_ISSUE_FILING_SCHEMA = "guild.github_issue_filing_decision.v1";
var PLUGIN_PATH_PATTERNS = [
  /^plugin\//,
  /\/plugin\//,
  /^docs\/v2\/16-host-adapter-migration-spec\.md$/,
  /^docs\/v2\/17-implementation-dod-and-verification\.md$/
];
var PROJECT_PATH_PATTERNS = [
  /^\.guild\//,
  /\/\.guild\//,
  /^docs\/knowledge\//,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /\/AGENTS\.md$/,
  /\/CLAUDE\.md$/,
  /^website\//,
  /^benchmark\//
];
var PLUGIN_TEXT_SIGNALS = [
  "host adapter",
  "review broker",
  "guild plugin",
  "plugin-level",
  "all hosts",
  "host-independent",
  "installer",
  "pre-flight",
  "preflight",
  "memory adapter",
  "flow is broken",
  "orchestrator"
];
var PROJECT_TEXT_SIGNALS = [
  "workspace-level",
  "project-level",
  "project local",
  "team knowledge",
  "wiki",
  ".guild",
  "agents.md",
  "project setting",
  "workspace setting",
  "docs/knowledge"
];
function textForFinding(finding) {
  return [
    finding.summary,
    finding.details,
    finding.proposed_change,
    ...finding.evidence_refs ?? [],
    ...finding.affected_artifacts ?? []
  ].filter(Boolean).join("\n").toLowerCase();
}
function pathSignals(paths, patterns) {
  return paths.filter((p) => patterns.some((pattern) => pattern.test(p)));
}
function wordSignals(text, signals) {
  return signals.filter((signal) => text.includes(signal));
}
function classifyRunLearning(finding) {
  const paths = [...finding.evidence_refs ?? [], ...finding.affected_artifacts ?? []];
  const text = textForFinding(finding);
  const pluginReasons = [
    ...pathSignals(paths, PLUGIN_PATH_PATTERNS).map((p) => `plugin artifact: ${p}`),
    ...wordSignals(text, PLUGIN_TEXT_SIGNALS).map((s) => `plugin signal: ${s}`)
  ];
  const projectReasons = [
    ...pathSignals(paths, PROJECT_PATH_PATTERNS).map((p) => `workspace/project artifact: ${p}`),
    ...wordSignals(text, PROJECT_TEXT_SIGNALS).map((s) => `workspace/project signal: ${s}`)
  ];
  if (finding.level_hint && finding.level_hint !== "ambiguous") {
    const externalizing = finding.level_hint === "plugin" || finding.level_hint === "mixed";
    if (externalizing && pluginReasons.length === 0) {
      return {
        schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
        finding_id: finding.id,
        level: "ambiguous",
        confidence: "low",
        reasons: [
          `level hint "${finding.level_hint}" has NO corroborating plugin signal \u2014 refusing to externalize on a hint alone`,
          ...projectReasons
        ],
        recommended_owner: "operator_triage",
        normal_gate: "human_triage",
        external_share_allowed: false
      };
    }
    const gate = finding.level_hint === "plugin" ? "plugin_issue_approval" : finding.level_hint === "mixed" ? "split_required" : "project_learning_gate";
    const owner = finding.level_hint === "plugin" ? "guild_plugin_maintainers" : finding.level_hint === "mixed" ? "split_between_project_and_plugin" : "workspace_or_project_maintainer";
    return {
      schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
      finding_id: finding.id,
      level: finding.level_hint,
      confidence: "high",
      reasons: [
        `explicit level hint: ${finding.level_hint}`,
        ...externalizing ? pluginReasons : []
      ],
      recommended_owner: owner,
      normal_gate: gate,
      external_share_allowed: false
    };
  }
  let level;
  let confidence;
  let normal_gate;
  let recommended_owner;
  let reasons;
  if (pluginReasons.length > 0 && projectReasons.length > 0) {
    level = "mixed";
    confidence = "high";
    normal_gate = "split_required";
    recommended_owner = "split_between_project_and_plugin";
    reasons = [...pluginReasons, ...projectReasons];
  } else if (pluginReasons.length > 0) {
    level = "plugin";
    confidence = pluginReasons.length > 1 ? "high" : "medium";
    normal_gate = "plugin_issue_approval";
    recommended_owner = "guild_plugin_maintainers";
    reasons = pluginReasons;
  } else if (projectReasons.length > 0) {
    level = "workspace_project";
    confidence = projectReasons.length > 1 ? "high" : "medium";
    normal_gate = "project_learning_gate";
    recommended_owner = "workspace_or_project_maintainer";
    reasons = projectReasons;
  } else {
    level = "ambiguous";
    confidence = "low";
    normal_gate = "human_triage";
    recommended_owner = "operator_triage";
    reasons = ["no plugin or workspace/project routing signals"];
  }
  return {
    schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
    finding_id: finding.id,
    level,
    confidence,
    reasons,
    recommended_owner,
    normal_gate,
    external_share_allowed: false
  };
}
function sanitizeForIssue(input, policy) {
  return redactRunString(input, policy);
}
function draftPluginGitHubIssue(finding, classification = classifyRunLearning(finding), policy) {
  if (classification.level !== "plugin" && classification.level !== "mixed") return null;
  const title = sanitizeForIssue(`[Guild] ${finding.summary}`, policy).slice(0, 120);
  const evidence = (finding.evidence_refs ?? []).map((ref) => `- ${sanitizeForIssue(ref, policy)}`).join("\n") || "- None provided";
  const artifacts = (finding.affected_artifacts ?? []).map((ref) => `- ${sanitizeForIssue(ref, policy)}`).join("\n") || "- None provided";
  const body = sanitizeForIssue([
    "## Summary",
    finding.summary,
    "",
    "## Classification",
    `Level: ${classification.level}`,
    `Confidence: ${classification.confidence}`,
    `Recommended owner: ${classification.recommended_owner}`,
    "",
    "## Details",
    finding.details ?? "No details provided.",
    "",
    "## Proposed Change",
    finding.proposed_change ?? "No proposed change provided.",
    "",
    "## Evidence",
    evidence,
    "",
    "## Affected Artifacts",
    artifacts,
    "",
    "## Sharing Gate",
    "Prepared locally by Guild. Do not file or share until the operator approves this exact draft."
  ].join("\n"), policy);
  return {
    schema_version: GITHUB_ISSUE_DRAFT_SCHEMA,
    source_finding_id: finding.id,
    repo: "guild/plugin",
    title,
    body,
    labels: ["guild-learning", classification.level === "mixed" ? "mixed-scope" : "plugin-level"],
    sanitized: true,
    approval_required: true
  };
}
function decideGitHubIssueFiling(draft, approval) {
  if (!draft) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "not_applicable",
      repo: "guild/plugin",
      draft: null,
      reason: "finding is not plugin-level or mixed-scope",
      approval_required: false
    };
  }
  if (!approval) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "approval_required",
      repo: "guild/plugin",
      draft,
      reason: "operator approval is required before external GitHub issue filing",
      approval_required: true
    };
  }
  if (!approval.approved) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "denied",
      repo: "guild/plugin",
      draft,
      reason: approval.reason ?? "operator denied external GitHub issue filing",
      approval_required: true,
      approval
    };
  }
  return {
    schema_version: GITHUB_ISSUE_FILING_SCHEMA,
    status: "ready_to_file",
    repo: "guild/plugin",
    draft,
    reason: "operator approved this sanitized GitHub issue draft",
    approval_required: false,
    approval
  };
}

// scripts/feedback-triage.ts
var TRIAGE_SCHEMA = "guild.feedback_triage.v1";
var FILED_SCHEMA = "guild.feedback_filed.v1";
var DEFAULT_ISSUE_REPO = "lookatitude/guild";
var SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function assertSafeId(kind, value) {
  if (!SAFE_ID_RE.test(value) || value.includes("..")) {
    throw new Error(
      `[feedback-triage] unsafe ${kind} "${value}" \u2014 ids must match ${SAFE_ID_RE} (no path separators, no "..")`
    );
  }
}
function feedbackDir(cwd, runId) {
  assertSafeId("run id", runId);
  return path7.join(cwd, ".guild", "feedback", runId);
}
function runTriage(opts) {
  const fsi = opts.fsi ?? fs5;
  const log = opts.log ?? ((l) => process.stderr.write(`[feedback-triage] ${l}
`));
  const dir = feedbackDir(opts.cwd, opts.runId);
  fsi.mkdirSync(dir, { recursive: true });
  for (const f of opts.findings) assertSafeId("finding id", f.id);
  const record = {
    schema_version: TRIAGE_SCHEMA,
    run_id: opts.runId,
    triaged_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
    findings: opts.findings.map((finding) => {
      const classification = classifyRunLearning(finding);
      const draft = draftPluginGitHubIssue(finding, classification);
      return { finding, classification, draft };
    })
  };
  fsi.writeFileSync(
    path7.join(dir, "triage.json"),
    JSON.stringify(record, null, 2) + "\n",
    "utf8"
  );
  for (const f of record.findings) {
    if (!f.draft) continue;
    fsi.writeFileSync(
      path7.join(dir, `${f.finding.id}.draft.md`),
      `<!-- ${f.draft.schema_version} \xB7 sanitized \xB7 approval_required -->
# ${f.draft.title}

${f.draft.body}
`,
      "utf8"
    );
  }
  const counts = { workspace_project: 0, plugin: 0, mixed: 0, ambiguous: 0 };
  for (const f of record.findings) counts[f.classification.level]++;
  log(
    `triaged ${record.findings.length} finding(s): ${counts.workspace_project} project \xB7 ${counts.plugin} plugin \xB7 ${counts.mixed} mixed \xB7 ${counts.ambiguous} ambiguous \u2192 ${dir}/triage.json`
  );
  const drafts = record.findings.filter((f) => f.draft);
  if (drafts.length > 0) {
    log(`${drafts.length} sanitized plugin-issue draft(s) prepared \u2014 NOT filed:`);
    for (const f of drafts) log(`  \xB7 ${dir}/${f.finding.id}.draft.md`);
    log(
      `Ask the operator per draft, then: feedback-triage.ts file --run-id ${opts.runId} --finding <id> --approve "<operator>" (or --deny [reason]).`
    );
  }
  return record;
}
function runFile(opts) {
  const fsi = opts.fsi ?? fs5;
  const log = opts.log ?? ((l) => process.stderr.write(`[feedback-triage] ${l}
`));
  const gh = opts.gh ?? ((args2) => (0, import_child_process.execFileSync)("gh", args2, { encoding: "utf8" }).trim());
  assertSafeId("finding id", opts.findingId);
  const dir = feedbackDir(opts.cwd, opts.runId);
  const triagePath = path7.join(dir, "triage.json");
  let record;
  try {
    record = JSON.parse(fsi.readFileSync(triagePath, "utf8"));
  } catch {
    log(`no triage record at ${triagePath} \u2014 run \`triage\` first.`);
    return 1;
  }
  const entry = record.findings.find((f) => f.finding.id === opts.findingId);
  if (!entry) {
    log(`finding "${opts.findingId}" not in ${triagePath}.`);
    return 1;
  }
  const approval = opts.approve ? {
    approved: true,
    approved_by: opts.approve,
    approved_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString()
  } : opts.deny ? { approved: false, reason: opts.denyReason ?? "operator denied" } : void 0;
  const decision = decideGitHubIssueFiling(entry.draft, approval);
  const filedPath = path7.join(dir, "filed.json");
  const filed = (() => {
    try {
      return JSON.parse(fsi.readFileSync(filedPath, "utf8"));
    } catch {
      return [];
    }
  })();
  if (decision.status === "not_applicable") {
    log("finding is not plugin-level/mixed \u2014 nothing to file (route it to the project learning gate).");
    return 1;
  }
  if (decision.status === "approval_required") {
    log('REFUSED: operator approval is required \u2014 re-run with --approve "<operator>" or --deny.');
    return 2;
  }
  if (decision.status === "denied") {
    filed.push({
      finding_id: opts.findingId,
      status: "denied",
      at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
      reason: decision.reason
    });
    fsi.writeFileSync(filedPath, JSON.stringify(filed, null, 2) + "\n", "utf8");
    log(`denial recorded \u2014 nothing filed (${decision.reason}).`);
    return 0;
  }
  const draft = decision.draft;
  const repo = opts.repo ?? DEFAULT_ISSUE_REPO;
  if (opts.dryRun) {
    log(`dry-run: would file to ${repo}: "${draft.title}" (labels: ${draft.labels.join(", ")})`);
    return 0;
  }
  const bodyFile = path7.join(dir, `${opts.findingId}.filed-body.md`);
  fsi.writeFileSync(bodyFile, draft.body, "utf8");
  const url = gh([
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    draft.title,
    "--body-file",
    bodyFile,
    ...draft.labels.flatMap((l) => ["--label", l])
  ]);
  filed.push({
    finding_id: opts.findingId,
    status: "filed",
    at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
    by: opts.approve,
    issue_url: url
  });
  fsi.writeFileSync(filedPath, JSON.stringify(filed, null, 2) + "\n", "utf8");
  log(`filed: ${url}`);
  return 0;
}
function main() {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let runId = null;
  let findingsPath = null;
  let findingId = null;
  let approve = null;
  let deny = false;
  let denyReason;
  let cwd = process.cwd();
  let dryRun = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id" && argv[i + 1]) runId = argv[++i];
    else if (a === "--findings" && argv[i + 1]) findingsPath = argv[++i];
    else if (a === "--finding" && argv[i + 1]) findingId = argv[++i];
    else if (a === "--approve" && argv[i + 1]) approve = argv[++i];
    else if (a === "--deny") {
      deny = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) denyReason = argv[++i];
    } else if (a === "--cwd" && argv[i + 1]) cwd = path7.resolve(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else {
      process.stderr.write(`[feedback-triage] unknown argument: ${a}
`);
      return 1;
    }
  }
  if (!runId) {
    process.stderr.write("[feedback-triage] --run-id is required\n");
    return 1;
  }
  if (cmd === "triage") {
    if (!findingsPath) {
      process.stderr.write("[feedback-triage] triage requires --findings <findings.json>\n");
      return 1;
    }
    const findings = JSON.parse(fs5.readFileSync(findingsPath, "utf8"));
    if (!Array.isArray(findings)) {
      process.stderr.write("[feedback-triage] findings file must be a JSON array of RunLearningFinding\n");
      return 1;
    }
    runTriage({ cwd, runId, findings });
    return 0;
  }
  if (cmd === "file") {
    if (!findingId) {
      process.stderr.write("[feedback-triage] file requires --finding <finding-id>\n");
      return 1;
    }
    return runFile({
      cwd,
      runId,
      findingId,
      ...approve ? { approve } : {},
      deny,
      ...denyReason !== void 0 ? { denyReason } : {},
      dryRun
    });
  }
  process.stderr.write("[feedback-triage] usage: feedback-triage.ts <triage|file> \u2026\n");
  return 1;
}
if (require.main === module) process.exit(main());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FILED_SCHEMA,
  SAFE_ID_RE,
  TRIAGE_SCHEMA,
  assertSafeId,
  feedbackDir,
  runFile,
  runTriage
});
