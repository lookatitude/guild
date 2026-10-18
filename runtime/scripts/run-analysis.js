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

// scripts/node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "scripts/node_modules/js-yaml/lib/schema.js"(exports2, module2) {
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
    function representYamlBinary(object) {
      let result2 = "";
      let bits = 0;
      const max = object.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result2 += map[bits >> 18 & 63];
          result2 += map[bits >> 12 & 63];
          result2 += map[bits >> 6 & 63];
          result2 += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
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
      const result2 = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result2[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object = data;
      const result2 = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
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

// scripts/run-analysis.ts
var run_analysis_exports = {};
__export(run_analysis_exports, {
  main: () => main
});
module.exports = __toCommonJS(run_analysis_exports);
var path16 = __toESM(require("node:path"));

// src/domains/telemetry/receipt-journal.ts
var fs10 = __toESM(require("node:fs"));
var path13 = __toESM(require("node:path"));
var crypto3 = __toESM(require("node:crypto"));

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
var import_node_module = require("node:module");
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
    const requireFrom = (0, import_node_module.createRequire)(path4.join(scriptsRoot, "package.json"));
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
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path5.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path5.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs4.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path5.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
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

// src/domains/state/frontmatter.ts
var loadedYaml = null;
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
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

// src/domains/state/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs5 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));
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
    const abs = path7.isAbsolute(raw) ? raw : path7.resolve(cwd, raw);
    const root = path7.dirname(abs);
    if (fs5.existsSync(root)) return root;
  } catch {
  }
  return path7.resolve(cwd);
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
    fs5.mkdirSync(path7.dirname(dbPath), { recursive: true });
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
    dbPath = path7.join(guildRoot, ".guild", "index.sqlite");
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
if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runIndexMigrateCli();
}

// src/domains/state/storage-policy.ts
var path8 = __toESM(require("node:path"));
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
  sources: path8.join("knowledge", "sources"),
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
var fs6 = __toESM(require("node:fs"));
var path9 = __toESM(require("node:path"));
function lstatSafe(p) {
  try {
    return fs6.lstatSync(p);
  } catch {
    return null;
  }
}
function readdirSafe(dir) {
  try {
    return fs6.readdirSync(dir);
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
    real = fs6.realpathSync(abs);
    realRoot = fs6.realpathSync(root);
  } catch {
    return null;
  }
  const rel2 = path9.relative(realRoot, real);
  if (rel2 === "" || rel2.startsWith("..") || path9.isAbsolute(rel2)) return null;
  return real;
}
function isContainedRealDir(abs, root) {
  return resolveContainedRealDir(abs, root) !== null;
}
function removeContainedTree(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs6.rmSync(real, { recursive: true, force: true });
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
var fs7 = __toESM(require("node:fs"));
var path10 = __toESM(require("node:path"));
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
  const rel2 = relToGuild.split(path10.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel2)) ? "derived" : "durable";
}
function rel(ctx, abs) {
  return path10.relative(ctx.root, abs).split(path10.sep).join("/");
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
    return fs7.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
function writeFile(ctx, abs, text) {
  if (ctx.dryRun) return;
  fs7.mkdirSync(path10.dirname(abs), { recursive: true });
  fs7.writeFileSync(abs, text, "utf8");
}
function sha256(text) {
  return crypto2.createHash("sha256").update(text).digest("hex");
}
function filesUnder(dir, out = []) {
  for (const name of readdirSafe(dir)) {
    const abs = path10.join(dir, name);
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
    const legacy = readIfFile(path10.join(ctx.guildDir, "settings.json"));
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
  const scalar2 = raw !== void 0 ? raw !== "" : isPlainScalar(parsed) && String(parsed) !== "";
  if (!scalar2) return false;
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
    const roots = ["initiatives", "team", "teams"].map((d) => path10.join(ctx.guildDir, d));
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
      const abs = path10.join(ctx.guildDir, name);
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
        fs7.rmSync(abs, { force: true });
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
    const runsDir = path10.join(ctx.guildDir, "runs");
    if (!isContainedRealDir(runsDir, ctx.guildDir)) {
      return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
    }
    const written = [];
    let open = 0;
    for (const name of readdirSafe(runsDir)) {
      if (name.startsWith("_")) continue;
      const runDir2 = path10.join(runsDir, name);
      if (!isContainedRealDir(runDir2, ctx.guildDir)) continue;
      const receipt = path10.join(runDir2, "receipt.json");
      if (lstatSafe(receipt)) continue;
      const runYaml = readIfFile(path10.join(runDir2, "run.yaml"));
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
    const abs = path10.join(ctx.guildDir, "current-run-id");
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
    if (!ctx.dryRun) fs7.rmSync(abs, { force: true });
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
    const dir = path10.join(ctx.guildDir, LEGACY_VERSION_TREE);
    if (!isContainedRealDir(dir, ctx.guildDir)) {
      return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
    }
    const snapshots = filesUnder(dir);
    if (snapshots.length === 0) {
      if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
      return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
    }
    const live = /* @__PURE__ */ new Set();
    const skillsDir = path10.join(ctx.guildDir, "skills");
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
      const abs = path10.join(ctx.guildDir, relPath);
      if (!lstatSafe(abs)) continue;
      if (classifyPath(relPath) !== "derived") continue;
      if (!ctx.dryRun) fs7.rmSync(abs, { force: true });
      changed.push(rel(ctx, abs));
    }
    for (const relPath of AUTHORED_REGISTRIES) {
      const abs = path10.join(ctx.guildDir, relPath);
      const text = readIfFile(abs);
      if (text === null) continue;
      const target = path10.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
      if (lstatSafe(target)) continue;
      writeFile(ctx, target, text);
      if (!ctx.dryRun) fs7.rmSync(abs, { force: true });
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
var fs8 = __toESM(require("fs"));
var path11 = __toESM(require("path"));
function federatedQuery(root, query, scope) {
  const manifestPath = path11.join(durableGuildDir(root), "workspace.json");
  if (!fs8.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs8.readFileSync(manifestPath, "utf8"));
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
    const subAbsPath = path11.resolve(root, sg.path);
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
  if (!fs8.existsSync(path11.join(durableGuildDir(cwd), "workspace.json"))) {
    process.stderr.write(
      `[workspace/federated-query] ERROR: no workspace.json at ${path11.join(durableGuildDir(cwd), "workspace.json")}
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
var fs9 = __toESM(require("fs"));
var path12 = __toESM(require("path"));
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
  const manifestPath = path12.join(durableGuildDir(workspaceRoot), "workspace.json");
  if (!fs9.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs9.readFileSync(manifestPath, "utf8"));
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
  const runsDir = path12.join(durableGuildDir(childDir), "runs");
  if (!fs9.existsSync(runsDir)) return [];
  const results = [];
  try {
    const runIds = fs9.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path12.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs9.existsSync(candidate)) {
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
    raw = JSON.parse(fs9.readFileSync(harvestPath, "utf8"));
  } catch {
    return [];
  }
  const sourcePath = path12.relative(workspaceRoot, harvestPath);
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
    const childDir = path12.join(workspaceRoot, child.path);
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
  if (!fs9.existsSync(workspaceRoot) || !fs9.statSync(workspaceRoot).isDirectory()) {
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
    const runsBase = path12.resolve(durableGuildDir(workspaceRoot), "runs");
    const runsDir = path12.join(runsBase, runId);
    const manifestPath = path12.join(runsDir, "upstream-candidates.json");
    const resolvedRunsDir = path12.resolve(runsDir);
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

// src/domains/telemetry/receipt-journal.ts
var RECEIPT_CONTRACT_VERSION = "guild.observability.v1";
var RECEIPT_DISPOSITIONS = Object.freeze([
  "succeeded",
  "refused",
  "unsupported",
  "failed",
  "degraded"
]);
var OBSERVATION_STATES = Object.freeze([
  "checked_clean",
  "not_applicable",
  "not_observed",
  "observation_failed"
]);
var RECEIPT_EVENT_NAMES = Object.freeze([
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
var RECEIPT_OUTCOME_TYPES = Object.freeze([
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
  return `sha256:${crypto3.createHash("sha256").update(text, "utf8").digest("hex")}`;
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
var UNPINNED_FD = -1;
var JournalAuthorityDetachedError = class extends Error {
  failure;
  constructor(failure) {
    super(failure.message);
    this.name = "JournalAuthorityDetachedError";
    this.failure = failure;
  }
};
var ACTIVE_LOCK_PUBLICATION = null;
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
    written += fs10.writeSync(fd, buf, written, buf.length - written);
  }
}
function readAllSync(fd) {
  const size = fs10.fstatSync(fd).size;
  if (size === 0) return "";
  const buf = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const n = fs10.readSync(fd, buf, read, size - read, read);
    if (n <= 0) break;
    read += n;
  }
  return buf.subarray(0, read).toString("utf8");
}
var defaultJournalIo = {
  appendLine(journalPath, text, bound) {
    bound?.guard?.("immediately before the append syscall");
    if (bound && bound.writable && bound.fd >= 0) {
      writeAllSync(bound.fd, text);
      fs10.fsyncSync(bound.fd);
      return;
    }
    fs10.mkdirSync(path13.dirname(journalPath), { recursive: true });
    const fd = fs10.openSync(journalPath, "a");
    try {
      fs10.writeSync(fd, text, null, "utf8");
      fs10.fsyncSync(fd);
    } finally {
      fs10.closeSync(fd);
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
      return fs10.readFileSync(journalPath, "utf8");
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
      fs10.ftruncateSync(bound.fd, size);
      return;
    }
    fs10.truncateSync(journalPath, size);
  },
  // `mkdir` is the portable atomic test-and-set: it either creates the
  // directory or fails EEXIST, with no window in between. `open(O_CREAT|O_EXCL)`
  // has the same guarantee locally but is famously unreliable over NFS, and
  // Guild journals can live on a shared volume.
  acquireLock(lockPath) {
    fs10.mkdirSync(path13.dirname(lockPath), { recursive: true });
    try {
      fs10.mkdirSync(lockPath);
    } catch (err) {
      if (err.code === "EEXIST") return false;
      throw err;
    }
    let fd = null;
    try {
      fd = fs10.openSync(lockPath, "r");
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
      fs10.rmdirSync(lockPath);
    } catch {
    }
  }
};
var CANONICAL_PATH_MAX_LINK_HOPS = 32;
function realpathOrNull(target) {
  try {
    return (fs10.realpathSync.native ?? fs10.realpathSync)(target);
  } catch {
    return null;
  }
}
function readlinkOrNull(target) {
  try {
    return fs10.readlinkSync(target);
  } catch {
    return null;
  }
}
function canonicalJournalPath(journalPath) {
  let current = path13.resolve(journalPath);
  for (let hop = 0; hop < CANONICAL_PATH_MAX_LINK_HOPS; hop += 1) {
    const real = realpathOrNull(current);
    if (real !== null) return real;
    const link = readlinkOrNull(current);
    if (link !== null) {
      const next = path13.resolve(path13.dirname(current), link);
      if (next === current) return current;
      current = next;
      continue;
    }
    const parent = path13.dirname(current);
    if (parent === current) return current;
    return path13.join(canonicalJournalPath(parent), path13.basename(current));
  }
  return current;
}
var JournalIdentityError = class extends Error {
  code;
  constructor(failure) {
    super(failure.message);
    this.name = "JournalIdentityError";
    this.code = failure.code;
  }
};
function lstatOrNull2(target) {
  try {
    return fs10.lstatSync(target);
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
var JOURNAL_LOCK_MAX_ATTEMPTS = 600;
var JOURNAL_LOCK_WAIT_MS = 20;
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
    return fs10.statSync(target);
  } catch {
    return null;
  }
}
function fstatOrNull(fd) {
  try {
    return fs10.fstatSync(fd);
  } catch {
    return null;
  }
}
function closeQuietly(fd) {
  try {
    fs10.closeSync(fd);
  } catch {
  }
}
var JOURNAL_ACCESS_FLAGS = {
  append: "a+",
  truncate: "r+",
  read: "r"
};
function acquireJournalAuthority(journalPath, io = defaultJournalIo, lockOptions = {}, access = "read", checkpointPath = null) {
  const resolved = resolveJournalIdentity(journalPath);
  if (!resolved.ok) return { ok: false, authority: null, identity: null, failure: resolved.failure };
  const identity = resolved.identity;
  const acquisition = acquireJournalLockHeld(identity.lock, io, lockOptions);
  if (acquisition.failure !== null) return { ok: false, authority: null, identity, failure: acquisition.failure };
  const grant = acquisition.grant;
  const journalParent = path13.dirname(identity.path);
  const parentStat = statOrNull(journalParent);
  const parentDevice = parentStat !== null ? parentStat.dev : null;
  const parentInode = parentStat !== null ? parentStat.ino : null;
  const checkpointParentPath = checkpointPath === null ? null : canonicalJournalPath(path13.dirname(checkpointPath));
  const checkpointCanonical = checkpointParentPath === null || checkpointPath === null ? null : path13.join(checkpointParentPath, path13.basename(checkpointPath));
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
      fd = fs10.openSync(identity.path, JOURNAL_ACCESS_FLAGS[access]);
      writable = access !== "read";
    } catch {
      fd = null;
    }
    if (fd === null) {
      try {
        fd = fs10.openSync(identity.path, "r");
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
      fd = fs10.openSync(checkpointParent, "r");
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
      const parentNow = statOrNull(path13.dirname(identity.path));
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
      const parentNamedNow = canonicalJournalPath(path13.dirname(checkpointPath));
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
var REQUIRED_STRING_FIELDS = [
  "run_id",
  "operation_id",
  "correlation_id",
  "event_id",
  "input_hash",
  "recorded_at"
];
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

// src/domains/telemetry/receipt-reconcile.ts
var INVALID_RECOVERY_REASONS = /* @__PURE__ */ new Set([
  "schema_invalid",
  "hash_mismatch",
  "foreign_run",
  "outside_declared_gap",
  "duplicate_sequence",
  "duplicate_event_id",
  "unknown_causation",
  "cause_not_before_effect"
]);
var REPAIR_ACCESS_DENIALS = /* @__PURE__ */ new Set([
  "repair_lock_unavailable",
  "repair_lock_failed",
  "repair_identity_ambiguous",
  "repair_identity_unstable"
]);
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
var highest = highestSequenceRecord;
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

// src/domains/telemetry/debug-bundle.ts
var DEBUG_BUNDLE_SECTION_KINDS = Object.freeze([
  "capability_snapshot",
  "normalized_event",
  "policy_decision",
  "transport_attempt",
  "artifact",
  "conformance"
]);

// src/domains/telemetry/receipt-journal-conformance-evaluator.ts
var fs11 = __toESM(require("node:fs"));
var path14 = __toESM(require("node:path"));
function freezeDeep(value) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.keys(node)) {
      walk(node[key]);
    }
  };
  walk(value);
  return value;
}
var MH06_OWNER_KEY = "W1/MH-06";
var MH06_SCENARIO_IDS = Object.freeze([
  "MHRC-RCT-001",
  "MHRC-RCT-002",
  "MHRC-RCT-003",
  "MHRC-RCT-004",
  "MHRC-RCT-005"
]);
var MH06_CATEGORY = "receipt_integrity";
var MH06_EVIDENCE_PROFILE = "E-RECEIPT";
var MH06_EXPECTED_OUTCOMES = Object.freeze({
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
var EVIDENCE_FRESHNESS_VERDICTS = Object.freeze(["fresh", "stale", "unknown"]);
var EVIDENCE_IDENTITY_FIELDS = Object.freeze([
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
var MH06_WAVE_OWNER = Object.freeze({ wave_id: "W1", work_item_id: "MH-06", key: MH06_OWNER_KEY });
function defineScenario(stableId2, title, eventName, preconditions, outcomeAssertions, evidenceAssertions) {
  const expected = MH06_EXPECTED_OUTCOMES[stableId2];
  return {
    stable_id: stableId2,
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
var MH06_SCENARIOS = Object.freeze(freezeDeep([
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
var MH06_PRODUCTION_JOURNAL = Object.freeze({
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
var MH06_REFUSAL_CONTROLS = Object.freeze({
  callerSuppliedIds: "caller_supplied_scenario_ids",
  callerSuppliedResults: "caller_supplied_results",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
  journalRootUnusable: "journal_root_unusable"
});
var MH06_SOURCE_VERSION = "guild.mh06.receipt-conformance.v1";
var PROBE_RECORDED_AT = "2026-01-01T00:00:00.000Z";
var PROBE_RECONCILED_AT = "2026-01-01T00:00:05.000Z";
var TORN_APPEND_CUT_BYTES = 40;
var PROBE_DIRS = Object.freeze({
  "MHRC-RCT-001": "rct001",
  "MHRC-RCT-002": "rct002",
  "MHRC-RCT-003": "rct003",
  "MHRC-RCT-004": "rct004",
  "MHRC-RCT-005": "rct005"
});
var JOURNAL_LEAF = "journal-lines";
var CHECKPOINT_LEAF = "checkpoint-state";
var CHECKPOINT_SCHEMA = "guild.receipt_checkpoint.v1";
function makeProbePaths(parent, name) {
  const dir = path14.join(parent, name);
  fs11.mkdirSync(dir, { recursive: true });
  return { dir, journal: path14.join(dir, JOURNAL_LEAF), checkpoint: path14.join(dir, CHECKPOINT_LEAF) };
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
function evidenceBindings(identity, runId, stableId2, record) {
  return {
    scenario_id: stableId2,
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
  fs11.writeFileSync(paths.journal, `${records.map((record) => JSON.stringify(record)).join("\n")}
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
  fs11.writeFileSync(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}
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
var PROBES = Object.freeze({
  "MHRC-RCT-001": probeAppendOrder,
  "MHRC-RCT-002": probeInterruptedAppend,
  "MHRC-RCT-003": probeObservationLoss,
  "MHRC-RCT-004": probeSequenceGaps,
  "MHRC-RCT-005": probeDuplicateDelivery
});

// src/domains/telemetry/guild-trace-events.ts
var crypto4 = __toESM(require("crypto"));
var ANALYSIS_EVENT_CLASSES = Object.freeze([
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
var GUILD_TRACE_SCHEMA_VERSIONS = Object.freeze([
  "guild.trace.dispatch.v1",
  "guild.trace.recall.v1",
  "guild.trace.recall_decision.v1",
  "guild.trace.config_resolution.v1",
  "guild.trace.security_decision.v1",
  "guild.trace.degradation.v1",
  "guild.trace.model_inspection.v1",
  "guild.trace.analysis.v2"
]);
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
var DISPATCH_BACKENDS = ["agent", "cmux", "tmux", "remote", "unknown"];
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
function validateAnalysisTraceEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.analysis.v2") {
    return { ok: false, reason: `wrong schema_version for analysis trace: ${e["schema_version"]}` };
  }
  if (!ANALYSIS_EVENT_CLASSES.includes(e["event_class"])) {
    return { ok: false, reason: `unknown analysis event_class: ${e["event_class"]}` };
  }
  if (!["lead", "agent", "user", "tool", "system"].includes(e["actor_type"])) {
    return { ok: false, reason: "actor_type must be lead|agent|user|tool|system" };
  }
  if (typeof e["actor_id"] !== "string" || e["actor_id"] === "") {
    return { ok: false, reason: "actor_id must be a non-empty string" };
  }
  if (!["ok", "error", "denied", "incomplete", "unknown"].includes(e["status"])) {
    return { ok: false, reason: "status must be ok|error|denied|incomplete|unknown" };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "ts",
    "run_id",
    "lane_id",
    "event_class",
    "actor_type",
    "actor_id",
    "status",
    "span_id",
    "parent_span_id",
    "phase",
    "task_id",
    "initiative_id",
    "run_scope",
    "prompt_hash",
    "payload_ref",
    "redaction",
    "duration_ms",
    "tokens",
    "config_snapshot_ref",
    "signature"
  ]);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unknown analysis field: ${key}` };
  }
  if (e["run_scope"] !== void 0 && !["initiative", "independent"].includes(e["run_scope"])) {
    return { ok: false, reason: "run_scope must be initiative|independent when present" };
  }
  if (e["duration_ms"] !== void 0 && (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0)) {
    return { ok: false, reason: "duration_ms must be a non-negative number when present" };
  }
  for (const key of ["span_id", "parent_span_id", "phase", "task_id", "initiative_id", "prompt_hash", "payload_ref", "config_snapshot_ref", "signature"]) {
    if (e[key] !== void 0 && (typeof e[key] !== "string" || e[key] === "")) {
      return { ok: false, reason: `${key} must be a non-empty string when present` };
    }
  }
  if (e["redaction"] !== void 0 && !["none", "redacted", "omitted"].includes(e["redaction"])) {
    return { ok: false, reason: "redaction must be none|redacted|omitted when present" };
  }
  if (e["tokens"] !== void 0) {
    if (typeof e["tokens"] !== "object" || e["tokens"] === null || Array.isArray(e["tokens"])) {
      return { ok: false, reason: "tokens must be an object when present" };
    }
    for (const [key, value] of Object.entries(e["tokens"])) {
      if (!["input", "output", "cached", "cost_usd"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, reason: `tokens.${key} must be a non-negative finite number` };
      }
    }
  }
  return ANALYSIS_CLASS_VALIDATORS[e["event_class"]](e);
}
var ANALYSIS_CLASS_REQUIREMENTS = Object.freeze({
  run_started: ["run_scope"],
  run_closed: ["run_scope"],
  run_attachment_resolved: ["run_scope", "signature"],
  config_snapshot_written: [],
  prompt_received: ["prompt_hash", "redaction", "span_id"],
  prompt_normalized: ["prompt_hash", "redaction", "span_id"],
  clarifying_question_asked: ["prompt_hash", "redaction", "span_id"],
  implementation_authorized: ["span_id", "signature"],
  agent_dispatched: ["task_id", "span_id"],
  agent_prompt_sent: ["prompt_hash", "redaction", "span_id", "task_id"],
  agent_response_received: ["span_id"],
  agent_handoff_written: ["task_id", "span_id", "payload_ref"],
  knowledge_lookup_started: ["span_id", "prompt_hash"],
  knowledge_lookup_result: ["span_id", "prompt_hash"],
  memory_lookup_started: ["span_id", "prompt_hash"],
  memory_lookup_result: ["span_id", "prompt_hash"],
  tool_call_started: ["span_id"],
  tool_call_finished: ["span_id", "duration_ms"],
  tool_call_denied: ["span_id", "signature"],
  tool_call_failed: ["span_id", "duration_ms"],
  loop_entered: ["span_id", "signature"],
  loop_iteration: ["span_id", "signature"],
  loop_exited: ["span_id", "signature"],
  loop_cap_hit: ["span_id", "signature"],
  phase_entered: ["span_id", "phase"],
  phase_concluded: ["span_id", "phase"],
  gate_started: ["span_id", "signature"],
  gate_concluded: ["span_id", "signature"],
  instruction_violation_detected: ["span_id", "signature"],
  user_steering_received: ["span_id", "signature"],
  correction_applied: ["span_id", "signature"],
  repeated_failure_detected: ["span_id", "signature"],
  recommendation_created: ["span_id", "signature"],
  recommendation_routed: ["span_id", "signature"],
  bug_report_prompted: ["span_id", "signature"]
});
var TOOL_DENIAL_CAUSES = Object.freeze(["policy", "user", "host_unavailable", "capability_absent"]);
var TOOL_DENIAL_SIGNATURE = new RegExp(`^(?:${TOOL_DENIAL_CAUSES.join("|")}):[A-Za-z0-9_.:-]{1,200}$`);
function requireFields(e, eventClass) {
  const missing = ANALYSIS_CLASS_REQUIREMENTS[eventClass].filter((key) => e[key] === void 0);
  return missing.length === 0 ? { ok: true } : { ok: false, reason: `${eventClass} requires ${missing.join(", ")}` };
}
function classValidator(eventClass, extra) {
  return (e) => {
    const required = requireFields(e, eventClass);
    if (!required.ok || !extra) return required;
    const reason = extra(e);
    return reason === null ? { ok: true } : { ok: false, reason: `${eventClass}: ${reason}` };
  };
}
var redactedPrompt = (e) => e["redaction"] === "none" ? "redaction must be redacted|omitted for a prompt-bearing class" : null;
var ANALYSIS_CLASS_VALIDATORS = Object.freeze(
  Object.fromEntries(ANALYSIS_EVENT_CLASSES.map((eventClass) => {
    switch (eventClass) {
      case "run_attachment_resolved":
        return [eventClass, classValidator(eventClass, (e) => String(e["signature"]).startsWith(`${e["run_scope"]}:`) ? null : "signature must start with <run_scope>:")];
      case "config_snapshot_written":
        return [eventClass, classValidator(eventClass, (e) => e["config_snapshot_ref"] === void 0 && e["payload_ref"] === void 0 ? "requires config_snapshot_ref or payload_ref" : null)];
      case "prompt_received":
      case "prompt_normalized":
      case "clarifying_question_asked":
      case "agent_prompt_sent":
        return [eventClass, classValidator(eventClass, redactedPrompt)];
      case "tool_call_denied":
        return [eventClass, classValidator(eventClass, (e) => e["status"] !== "denied" ? "status must be denied" : !TOOL_DENIAL_SIGNATURE.test(String(e["signature"])) ? `signature must be <${TOOL_DENIAL_CAUSES.join("|")}>:<tool>[:<action>]` : null)];
      case "instruction_violation_detected":
      case "user_steering_received":
      case "correction_applied":
      case "repeated_failure_detected":
      case "recommendation_created":
      case "recommendation_routed":
      case "bug_report_prompted":
        return [eventClass, classValidator(eventClass, (e) => /^\S{1,256}$/.test(String(e["signature"])) ? null : "signature must be 1-256 non-whitespace chars")];
      case "tool_call_failed":
        return [eventClass, classValidator(eventClass, (e) => e["status"] !== "error" ? "status must be error" : null)];
      default:
        return [eventClass, classValidator(eventClass)];
    }
  }))
);
function toolActionSignature(tool, commandRedacted) {
  const digest = crypto4.createHash("sha256").update(`${tool}
${commandRedacted}`).digest("hex").slice(0, 16);
  return `tool:${tool}:${digest}`;
}
var TWIN_TERMINAL_SUFFIXES = ["_finished", "_failed", "_denied", "_concluded", "_exited", "_result", "_closed", "_cap_hit"];
var TWIN_STATUS_RANK = { ok: 0, unknown: 1, incomplete: 2, denied: 3, error: 4 };
function twinRank(value) {
  const typed = value["schema_version"] === "guild.trace.analysis.v2" ? 1 : 0;
  const cls = typeof value["event_class"] === "string" ? value["event_class"] : "";
  const terminal = TWIN_TERMINAL_SUFFIXES.some((suffix) => cls.endsWith(suffix)) ? 1 : 0;
  const status = TWIN_STATUS_RANK[value["status"]] ?? -1;
  return [typed, terminal, status];
}
function outranks(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function twinEligible(value, runId) {
  const schema = value["schema_version"];
  if (typeof schema === "string" && schema.startsWith("guild.trace.")) {
    return value["run_id"] === runId && validateGuildTraceEvent(value).ok;
  }
  const rowRun = value["run_id"];
  return rowRun === void 0 || rowRun === runId;
}
function collapseSpanTwins(rows, runId) {
  const actions = [];
  const bySpan = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!twinEligible(row.value, runId)) continue;
    const span = typeof row.value["span_id"] === "string" && row.value["span_id"] !== "" ? row.value["span_id"] : null;
    if (span === null) {
      actions.push({ action: row, refs: [row.ref], span_id: null });
      continue;
    }
    const existing = bySpan.get(span);
    if (!existing) {
      const entry = { action: row, refs: [row.ref], span_id: span };
      bySpan.set(span, entry);
      actions.push(entry);
      continue;
    }
    existing.refs.push(row.ref);
    if (outranks(twinRank(row.value), twinRank(existing.action.value))) existing.action = row;
  }
  return actions.map(({ action, refs, span_id }) => ({ action, refs: [...new Set(refs)].sort(), span_id }));
}
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
    case "guild.trace.analysis.v2":
      return validateAnalysisTraceEvent(ev);
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

// src/domains/telemetry/task-cell-telemetry.ts
var TASK_CELL_LIFECYCLE_EVENTS = Object.freeze([
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
var EVENT_NAMES = new Set(TASK_CELL_LIFECYCLE_EVENTS);

// src/domains/telemetry/run-analysis.ts
var crypto5 = __toESM(require("node:crypto"));
var fs12 = __toESM(require("node:fs"));
var path15 = __toESM(require("node:path"));
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var RESERVED_RECOMMENDATION_SOURCE_IDS = /* @__PURE__ */ new Set(["activity", "queue"]);
var REQUIRED_COVERAGE = Object.freeze(["prompt", "agent", "tool", "phase", "loop", "gate", "close"]);
var COMPLETENESS_REQUIREMENTS = Object.freeze(["run identity", "plugin-config-snapshot.json", "trace parseability", "trace validity", ...REQUIRED_COVERAGE]);
var DETECTOR_IDS = Object.freeze([
  "clarification",
  "instruction_following",
  "knowledge_memory",
  "outcome_quality",
  "prompt_action_latency",
  "recommendation_scope",
  "redundant_prompt",
  "repeated_mistake",
  "steering",
  "tool_coverage",
  "usage_outlier",
  "workflow_churn"
]);
var USAGE_METRICS = Object.freeze(["input", "output", "cached", "cost_usd", "duration_ms"]);
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function scalar(record, key) {
  const value = record[key];
  return typeof value === "string" && value !== "null" && value.length > 0 ? value : null;
}
function sha2563(value) {
  return crypto5.createHash("sha256").update(value).digest("hex");
}
function stableId(prefix, material) {
  return `${prefix}-${sha2563(material).slice(0, 16)}`;
}
function assertSafeId(value, label) {
  if (!SAFE_ID.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be one safe path component`);
  }
}
function assertRecommendationSourceId(value, label) {
  assertSafeId(value, label);
  if (RESERVED_RECOMMENDATION_SOURCE_IDS.has(value.toLowerCase())) {
    throw new Error(`${label} is reserved by the recommendation store`);
  }
}
function runDir(root, runId) {
  assertSafeId(runId, "run id");
  const resolvedRoot = path15.resolve(root);
  const runs = path15.join(durableGuildDir(resolvedRoot), "runs");
  const candidate = path15.join(runs, runId);
  try {
    if (fs12.lstatSync(runs).isSymbolicLink() || fs12.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`run input path contains a symlink: ${candidate}`);
    }
    const realRoot = fs12.realpathSync(resolvedRoot);
    const realCandidate = fs12.realpathSync(candidate);
    if (!fs12.statSync(realCandidate).isDirectory() || !realCandidate.startsWith(`${realRoot}${path15.sep}`)) {
      throw new Error(`run input escapes project root: ${candidate}`);
    }
    return realCandidate;
  } catch (error) {
    if (error instanceof Error && /symlink|escapes/.test(error.message)) throw error;
    throw new Error(`run input is not a contained directory: ${candidate}`);
  }
}
function resolveContainedFile(base, relativeRef) {
  if (path15.isAbsolute(relativeRef)) return null;
  const resolvedBase = path15.resolve(base);
  const resolved = path15.resolve(resolvedBase, relativeRef);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path15.sep}`)) return null;
  try {
    const realBase = fs12.realpathSync(resolvedBase);
    const real = fs12.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(`${realBase}${path15.sep}`)) return null;
    return fs12.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}
function resolveRunInputFile(base, relativeRef) {
  if (path15.isAbsolute(relativeRef)) throw new Error(`run input ref must be relative: ${relativeRef}`);
  const resolvedBase = path15.resolve(base);
  const resolved = path15.resolve(resolvedBase, relativeRef);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path15.sep}`)) {
    throw new Error(`run input escapes its run directory: ${relativeRef}`);
  }
  const relative8 = path15.relative(resolvedBase, resolved);
  let cursor = resolvedBase;
  try {
    for (const component of relative8.split(path15.sep).filter(Boolean)) {
      cursor = path15.join(cursor, component);
      if (fs12.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`run input path contains a symlink: ${cursor}`);
      }
    }
    const realBase = fs12.realpathSync(resolvedBase);
    const real = fs12.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(`${realBase}${path15.sep}`)) {
      throw new Error(`run input escapes its run directory: ${relativeRef}`);
    }
    if (!fs12.statSync(real).isFile()) throw new Error(`run input is not a regular file: ${resolved}`);
    return real;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function readText(file) {
  try {
    return fs12.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
function assertOutputContained(root, file) {
  const resolvedRoot = path15.resolve(root);
  const resolvedFile = path15.resolve(file);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path15.sep}`)) {
    throw new Error(`analysis output escapes project root: ${resolvedFile}`);
  }
  const relative8 = path15.relative(resolvedRoot, resolvedFile);
  let cursor = resolvedRoot;
  for (const component of relative8.split(path15.sep).filter(Boolean)) {
    cursor = path15.join(cursor, component);
    try {
      if (fs12.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`analysis output path is not a contained regular file path because it contains a symlink: ${cursor}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
}
function atomicWrite2(root, file, contents) {
  assertOutputContained(root, file);
  fs12.mkdirSync(path15.dirname(file), { recursive: true });
  assertOutputContained(root, path15.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${crypto5.randomUUID()}`;
  try {
    fs12.writeFileSync(temp, contents, { encoding: "utf8", mode: 384, flag: "wx" });
    fs12.renameSync(temp, file);
  } finally {
    try {
      fs12.unlinkSync(temp);
    } catch {
    }
  }
}
function readLockOwner(root, file, schema) {
  const raw = readExistingContainedText(root, file);
  let owner;
  try {
    owner = asRecord(JSON.parse(raw ?? ""));
  } catch {
    throw new Error("recommendation store lock is malformed");
  }
  if (!hasOnlyKeys(owner, /* @__PURE__ */ new Set(["schema_version", "pid", "created_at"])) || owner["schema_version"] !== schema || !Number.isInteger(owner["pid"]) || Number(owner["pid"]) <= 0 || typeof owner["created_at"] !== "string" || !Number.isFinite(Date.parse(owner["created_at"]))) {
    throw new Error("recommendation store lock is malformed");
  }
  return owner;
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function unlinkOwnedLock(file, descriptor) {
  try {
    const held = fs12.fstatSync(descriptor);
    const current = fs12.lstatSync(file);
    if (sameInode(held, current)) fs12.unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function withRecommendationLock(root, action) {
  const dir = path15.join(durableGuildDir(root), "recommendations");
  const lock = path15.join(dir, ".write.lock");
  const recovery = path15.join(dir, ".write.lock.recovery");
  assertOutputContained(root, lock);
  assertOutputContained(root, recovery);
  fs12.mkdirSync(dir, { recursive: true });
  assertOutputContained(root, dir);
  let descriptor;
  const open = (duringRecovery = false) => {
    if (!duringRecovery && fs12.existsSync(recovery)) throw new Error("recommendation store lock recovery is active");
    const opened = fs12.openSync(lock, "wx", 384);
    if (!duringRecovery && fs12.existsSync(recovery)) {
      unlinkOwnedLock(lock, opened);
      fs12.closeSync(opened);
      throw new Error("recommendation store lock recovery is active");
    }
    return opened;
  };
  try {
    descriptor = open();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const original = fs12.lstatSync(lock);
    const owner = readLockOwner(root, lock, "guild.recommendation_lock.v1");
    if (processIsAlive(owner.pid)) throw new Error("recommendation store is locked by another writer");
    let recoveryDescriptor;
    try {
      recoveryDescriptor = fs12.openSync(recovery, "wx", 384);
    } catch (recoveryError) {
      if (recoveryError.code !== "EEXIST") throw recoveryError;
      readLockOwner(root, recovery, "guild.recommendation_lock_recovery.v1");
      throw new Error("recommendation store lock recovery is active");
    }
    fs12.writeFileSync(recoveryDescriptor, JSON.stringify({
      schema_version: "guild.recommendation_lock_recovery.v1",
      pid: process.pid,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    }) + "\n");
    try {
      const current = fs12.lstatSync(lock);
      const currentOwner = readLockOwner(root, lock, "guild.recommendation_lock.v1");
      if (!sameInode(original, current) || processIsAlive(currentOwner.pid)) {
        throw new Error("recommendation store lock changed during stale recovery");
      }
      fs12.unlinkSync(lock);
      descriptor = open(true);
    } finally {
      try {
        unlinkOwnedLock(recovery, recoveryDescriptor);
      } finally {
        fs12.closeSync(recoveryDescriptor);
      }
    }
  }
  fs12.writeFileSync(descriptor, JSON.stringify({
    schema_version: "guild.recommendation_lock.v1",
    pid: process.pid,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  }) + "\n");
  try {
    recoverPendingTransaction(root);
    return action();
  } finally {
    try {
      unlinkOwnedLock(lock, descriptor);
    } finally {
      fs12.closeSync(descriptor);
    }
  }
}
var RECOMMENDATION_SCOPES = /* @__PURE__ */ new Set(["plugin", "project"]);
var RECOMMENDATION_STATUSES = /* @__PURE__ */ new Set(["proposed", "accepted", "filed", "queued", "rejected", "implemented", "superseded"]);
var RECOMMENDATION_KINDS = /* @__PURE__ */ new Set([
  "bug_report",
  "feature_request",
  "telemetry_gap",
  "workflow_engine_gap",
  "tooling_gap",
  "docs_sync_gap",
  "create_skill",
  "evolve_skill",
  "create_agent",
  "update_workflow",
  "update_knowledge",
  "change_settings",
  "clarify_prompt_contract"
]);
var CONFIDENCE_VALUES = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var SEVERITY_VALUES = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var FINDING_KINDS = /* @__PURE__ */ new Set(["instruction_violation", "repeated_failure", "tool_gap", "workflow_churn", "prompt_inefficiency", "telemetry_gap"]);
var PLUGIN_RECOMMENDATION_KINDS = /* @__PURE__ */ new Set([
  "bug_report",
  "feature_request",
  "telemetry_gap",
  "workflow_engine_gap",
  "tooling_gap",
  "docs_sync_gap"
]);
var PROJECT_RECOMMENDATION_KINDS = /* @__PURE__ */ new Set([
  "create_skill",
  "evolve_skill",
  "create_agent",
  "update_workflow",
  "update_knowledge",
  "change_settings",
  "clarify_prompt_contract"
]);
var RECOMMENDATION_KEYS = /* @__PURE__ */ new Set([
  "schema_version",
  "id",
  "source_id",
  "source_analysis_id",
  "scope",
  "kind",
  "confidence",
  "severity",
  "evidence_refs",
  "evidence_signature",
  "affected_runs",
  "proposed_action",
  "suggested_owner",
  "next_action",
  "requires_user_approval",
  "status",
  "routing"
]);
var ROUTING_KEYS = /* @__PURE__ */ new Set(["action", "requires_user_approval", "target"]);
function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
function validEvidenceRef(value) {
  if (!value.startsWith(".guild/") || value.includes("\\") || /[\0\r\n]/.test(value)) return false;
  const filePart = value.split("#", 1)[0];
  const normalized = path15.posix.normalize(filePart);
  return normalized === filePart && !normalized.split("/").includes("..");
}
function evidenceRunId(value) {
  const match = /^\.guild\/runs\/([^/]+)\//.exec(value.split("#", 1)[0]);
  return match?.[1] ?? null;
}
function assertEvidenceFiles(root, item, label) {
  for (const ref of item.evidence_refs) {
    const file = ref.split("#", 1)[0];
    if (resolveContainedFile(root, file) === null) {
      throw new Error(`${label}.evidence_refs must resolve to contained regular files: ${ref}`);
    }
  }
}
function evidenceSignature(scope, kind, refs) {
  return sha2563([scope, kind, ...[...refs].sort()].join("\n"));
}
function assertRecommendation(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const item = value;
  const scope = item["scope"];
  const routing = item["routing"];
  if (!hasOnlyKeys(item, RECOMMENDATION_KEYS)) throw new Error(`${label} contains unknown fields`);
  if (item["schema_version"] !== "guild.recommendation.v1") throw new Error(`${label}.schema_version is invalid`);
  if (typeof item["id"] !== "string" || !SAFE_ID.test(item["id"]) || item["id"] === "." || item["id"] === "..") {
    throw new Error(`${label}.id must be one safe path component`);
  }
  if (typeof item["source_id"] !== "string" || !SAFE_ID.test(item["source_id"]) || item["source_id"] === "." || item["source_id"] === ".." || RESERVED_RECOMMENDATION_SOURCE_IDS.has(item["source_id"].toLowerCase())) {
    throw new Error(`${label}.source_id must be one safe path component`);
  }
  if (typeof item["source_analysis_id"] !== "string" || item["source_analysis_id"].length > 256 || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["source_analysis_id"])) {
    throw new Error(`${label}.source_analysis_id must be a safe analysis identifier`);
  }
  if (typeof scope !== "string" || !RECOMMENDATION_SCOPES.has(scope)) throw new Error(`${label}.scope is invalid`);
  if (typeof item["kind"] !== "string" || !RECOMMENDATION_KINDS.has(item["kind"])) throw new Error(`${label}.kind is invalid`);
  const kind = item["kind"];
  if (scope === "plugin" && !PLUGIN_RECOMMENDATION_KINDS.has(kind) || scope === "project" && !PROJECT_RECOMMENDATION_KINDS.has(kind)) {
    throw new Error(`${label}.kind is not authorized for ${scope} scope`);
  }
  if (typeof item["confidence"] !== "string" || !CONFIDENCE_VALUES.has(item["confidence"])) throw new Error(`${label}.confidence is invalid`);
  if (typeof item["severity"] !== "string" || !SEVERITY_VALUES.has(item["severity"])) throw new Error(`${label}.severity is invalid`);
  if (!stringArray(item["evidence_refs"]) || item["evidence_refs"].length === 0 || !item["evidence_refs"].every(validEvidenceRef)) {
    throw new Error(`${label}.evidence_refs must contain safe .guild refs`);
  }
  if (!stringArray(item["affected_runs"]) || item["affected_runs"].length === 0 || !item["affected_runs"].every((id) => SAFE_ID.test(id) && id !== "." && id !== "..")) {
    throw new Error(`${label}.affected_runs must contain safe run ids`);
  }
  if (!item["affected_runs"].every((runId) => item["evidence_refs"].some((ref) => evidenceRunId(ref) === runId)) || !item["evidence_refs"].every((ref) => item["affected_runs"].includes(evidenceRunId(ref) ?? ""))) {
    throw new Error(`${label}.affected_runs must be bound to run evidence refs`);
  }
  const expectedSignature = evidenceSignature(scope, kind, item["evidence_refs"]);
  if (item["evidence_signature"] !== expectedSignature) throw new Error(`${label}.evidence_signature does not match its evidence`);
  if (typeof item["proposed_action"] !== "string" || item["proposed_action"].trim().length === 0 || /[\0]/.test(item["proposed_action"])) {
    throw new Error(`${label}.proposed_action must be non-empty`);
  }
  const expected = routingForScope(scope);
  if (item["suggested_owner"] !== (scope === "plugin" ? "guild-plugin" : "project") || item["next_action"] !== expected.action || item["requires_user_approval"] !== true || routing === null || typeof routing !== "object" || Array.isArray(routing) || !hasOnlyKeys(routing, ROUTING_KEYS) || routing["action"] !== expected.action || routing["requires_user_approval"] !== true || routing["target"] !== expected.target) {
    throw new Error(`${label} routing does not match scope`);
  }
  if (typeof item["status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["status"])) throw new Error(`${label}.status is invalid`);
}
function readExistingContainedText(root, file) {
  if (!fs12.existsSync(file)) return null;
  const relative8 = path15.relative(path15.resolve(root), path15.resolve(file));
  const contained = resolveContainedFile(root, relative8);
  if (contained === null) throw new Error(`recommendation input is not a contained regular file: ${file}`);
  return fs12.readFileSync(contained, "utf8");
}
function readRecommendationRecords(root, file, required, expectedSourceId, expectedSourceAnalysisId) {
  const raw = readExistingContainedText(root, file);
  if (raw === null) {
    if (required) throw new Error(`recommendation source does not exist: ${file}`);
    return [];
  }
  const records = [];
  const ids = /* @__PURE__ */ new Set();
  const signatures = /* @__PURE__ */ new Set();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`recommendation record line ${index + 1} is not valid JSON`);
    }
    assertRecommendation(value, `recommendation record line ${index + 1}`);
    assertEvidenceFiles(root, value, `recommendation record line ${index + 1}`);
    if (expectedSourceId !== void 0 && value.source_id !== expectedSourceId) {
      throw new Error(`recommendation record line ${index + 1}.source_id does not match ${expectedSourceId}`);
    }
    if (expectedSourceAnalysisId !== void 0 && value.source_analysis_id !== expectedSourceAnalysisId) {
      throw new Error(`recommendation record line ${index + 1}.source_analysis_id does not match its canonical artifact`);
    }
    if (ids.has(value.id)) throw new Error(`duplicate recommendation id: ${value.id}`);
    if (signatures.has(value.evidence_signature)) throw new Error(`duplicate evidence signature: ${value.evidence_signature}`);
    ids.add(value.id);
    signatures.add(value.evidence_signature);
    records.push(value);
  }
  return records;
}
function writeRecommendationRecords(root, file, records) {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const ids = /* @__PURE__ */ new Set();
  const signatures = /* @__PURE__ */ new Set();
  sorted.forEach((record, index) => {
    assertRecommendation(record, `recommendation ${index + 1}`);
    assertEvidenceFiles(root, record, `recommendation ${index + 1}`);
    if (ids.has(record.id)) throw new Error(`duplicate recommendation id: ${record.id}`);
    if (signatures.has(record.evidence_signature)) throw new Error(`duplicate evidence signature: ${record.evidence_signature}`);
    ids.add(record.id);
    signatures.add(record.evidence_signature);
  });
  atomicWrite2(root, file, sorted.map((item) => JSON.stringify(item)).join("\n") + (sorted.length > 0 ? "\n" : ""));
}
function assertGeneratedRecommendations(root, incoming, context) {
  const ids = /* @__PURE__ */ new Set();
  const signatures = /* @__PURE__ */ new Set();
  for (const [index, item] of incoming.entries()) {
    const label = `generated recommendation ${index + 1}`;
    assertRecommendation(item, label);
    assertEvidenceFiles(root, item, label);
    if (item.status !== "proposed") throw new Error(`${label}.status must be proposed before an authorized transition`);
    if (item.source_id !== context.sourceId) throw new Error(`${label}.source_id is not bound to its enclosing artifact`);
    if (item.source_analysis_id !== context.sourceAnalysisId) throw new Error(`${label}.source_analysis_id is not bound to its enclosing artifact`);
    if (!item.affected_runs.every((runId) => context.runIds.includes(runId))) throw new Error(`${label}.affected_runs are not bound to its enclosing artifact`);
    if (ids.has(item.id)) throw new Error(`duplicate recommendation id: ${item.id}`);
    if (signatures.has(item.evidence_signature)) throw new Error(`duplicate evidence signature: ${item.evidence_signature}`);
    ids.add(item.id);
    signatures.add(item.evidence_signature);
  }
}
function recommendationQueueKey(item) {
  return item.evidence_signature;
}
function preserveRecordedStatuses(root, file, incoming, targetSourceAnalysisId) {
  const sourceId = path15.basename(file, ".jsonl");
  const existing = readRecommendationRecords(root, file, false, sourceId);
  const queue = readRecommendationRecords(root, path15.join(durableGuildDir(root), "recommendations", "queue.jsonl"), false);
  const activity = readRecommendationActivity(root);
  const migrations = [];
  const persisted = [
    ...existing,
    ...queue.filter((record) => record.source_id === sourceId)
  ];
  const records = incoming.map((item) => {
    const latestActivity = [...activity].reverse().find((event) => event.scope === item.scope && event.evidence_signature === item.evidence_signature);
    const priorSource = latestActivity && latestActivity.source_id !== sourceId ? readRecommendationRecords(
      root,
      recommendationSourceFile(root, latestActivity.source_id),
      false,
      latestActivity.source_id,
      latestActivity.source_analysis_id
    ) : [];
    const candidates = [...existing, ...queue, ...priorSource].filter((record) => record.scope === item.scope && (record.id === item.id || recommendationQueueKey(record) === recommendationQueueKey(item)));
    const progressedCandidates = candidates.filter((record) => record.status !== "proposed");
    if (progressedCandidates.length > 0 && !latestActivity) {
      throw new Error(`progressed recommendation ${item.id} has no authorized activity trail`);
    }
    const corroboratingCandidates = latestActivity ? candidates.filter((record) => record.id === latestActivity.recommendation_id && record.source_id === latestActivity.source_id && record.source_analysis_id === latestActivity.source_analysis_id) : [];
    if (latestActivity && !corroboratingCandidates.some((record) => record.status === latestActivity.to_status)) {
      throw new Error(`recommendation ${item.id} activity is not corroborated by persisted source or queue state`);
    }
    if (latestActivity && corroboratingCandidates.some((record) => record.status !== "proposed" && record.status !== latestActivity.to_status)) {
      throw new Error(`recommendation ${item.id} status contradicts its authorized activity trail`);
    }
    const prior = latestActivity ? { id: latestActivity.recommendation_id, source_id: latestActivity.source_id, source_analysis_id: latestActivity.source_analysis_id, status: latestActivity.to_status } : candidates.find((record) => record.id === item.id) ?? candidates[0];
    if (item.status !== "proposed" || !prior || prior.status === "proposed") return item;
    const preserved = { ...item, status: prior.status };
    if (prior.id !== item.id || prior.source_id !== item.source_id || prior.source_analysis_id !== item.source_analysis_id) {
      migrations.push({ item: preserved, fromId: prior.id, fromSourceId: prior.source_id, fromSourceAnalysisId: prior.source_analysis_id });
    }
    return preserved;
  });
  const matched = new Set(records.flatMap((record) => [record.id, recommendationQueueKey(record)]));
  const historical = /* @__PURE__ */ new Map();
  for (const prior of persisted) {
    if (prior.status === "proposed" || matched.has(prior.id) || matched.has(recommendationQueueKey(prior))) continue;
    const key = `${prior.scope}:${recommendationQueueKey(prior)}`;
    const duplicate = historical.get(key);
    if (duplicate && duplicate.status !== prior.status) {
      throw new Error(`progressed recommendation ${prior.id} has contradictory persisted statuses`);
    }
    historical.set(key, prior);
  }
  for (const prior of historical.values()) {
    const latestActivity = [...activity].reverse().find((event) => event.scope === prior.scope && event.evidence_signature === prior.evidence_signature);
    if (!latestActivity || latestActivity.to_status !== prior.status || latestActivity.recommendation_id !== prior.id || latestActivity.source_id !== prior.source_id || latestActivity.source_analysis_id !== prior.source_analysis_id) {
      throw new Error(`progressed recommendation ${prior.id} is not corroborated by its authorized activity trail`);
    }
    const carried = {
      ...prior,
      source_id: sourceId,
      source_analysis_id: targetSourceAnalysisId
    };
    records.push(carried);
    matched.add(carried.id);
    matched.add(recommendationQueueKey(carried));
    if (prior.source_analysis_id !== targetSourceAnalysisId) {
      migrations.push({
        item: carried,
        fromId: prior.id,
        fromSourceId: prior.source_id,
        fromSourceAnalysisId: prior.source_analysis_id
      });
    }
  }
  return { records, migrations };
}
function upsertProjectQueue(root, incoming, explicitStatus = false) {
  const queue = path15.join(durableGuildDir(root), "recommendations", "queue.jsonl");
  const records = readRecommendationRecords(root, queue, false);
  if (records.some((item) => item.scope !== "project")) throw new Error("project recommendation queue contains a non-project record");
  for (const item of incoming.filter((candidate) => candidate.scope === "project")) {
    assertRecommendation(item, `queued recommendation ${item.id}`);
    const signature = recommendationQueueKey(item);
    const index = records.findIndex((record) => record.id === item.id || recommendationQueueKey(record) === signature);
    if (index === -1) {
      records.push(item);
    } else {
      const existing = records[index];
      records[index] = !explicitStatus && item.status === "proposed" && existing.status !== "proposed" ? { ...item, status: existing.status } : item;
    }
  }
  writeRecommendationRecords(root, queue, records);
  return queue;
}
function recommendationSourceFile(root, sourceId) {
  assertRecommendationSourceId(sourceId, "recommendation source id");
  return path15.join(durableGuildDir(root), "recommendations", `${sourceId}.jsonl`);
}
function canonicalSourceAnalysisId(root, sourceId) {
  const runArtifact = path15.join(durableGuildDir(root), "analysis", "runs", sourceId, "analysis.json");
  const comparisonArtifact = path15.join(durableGuildDir(root), "analysis", "comparisons", sourceId, "comparison.json");
  for (const [file, schema, idKey, analysisKey] of [
    [runArtifact, "guild.run_analysis.v1", "run_id", "analysis_id"],
    [comparisonArtifact, "guild.run_comparison.v1", "comparison_id", "comparison_id"]
  ]) {
    const raw = readExistingContainedText(root, file);
    if (raw === null) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`canonical recommendation source is malformed: ${file}`);
    }
    const item = asRecord(parsed);
    if (item["schema_version"] !== schema || item[idKey] !== sourceId || typeof item[analysisKey] !== "string") {
      throw new Error(`canonical recommendation source identity is invalid: ${file}`);
    }
    return item[analysisKey];
  }
  throw new Error(`canonical recommendation source artifact does not exist for ${sourceId}`);
}
var RECOMMENDATION_ACTIVITY_KEYS = /* @__PURE__ */ new Set([
  "schema_version",
  "activity_id",
  "at",
  "source_id",
  "source_analysis_id",
  "recommendation_id",
  "previous_recommendation_id",
  "previous_source_id",
  "previous_source_analysis_id",
  "evidence_signature",
  "scope",
  "from_status",
  "to_status",
  "effect"
]);
var RECOMMENDATION_ACTIVITY_EFFECTS = /* @__PURE__ */ new Set([
  "plugin_draft_written",
  "project_proposal_queued",
  "recommendation_rejected",
  "status_recorded",
  "status_migrated"
]);
function authorizedProgressTransition(scope, from, to) {
  if (from === to) return true;
  return scope === "project" ? from === "queued" && (to === "implemented" || to === "superseded") : from === "accepted" && (to === "filed" || to === "implemented" || to === "superseded") || from === "filed" && (to === "implemented" || to === "superseded");
}
function activitySemantics(item) {
  const scope = item["scope"];
  const from = item["from_status"];
  const to = item["to_status"];
  const effect = item["effect"];
  if (effect === "plugin_draft_written") return scope === "plugin" && from === "proposed" && to === "accepted";
  if (effect === "project_proposal_queued") return scope === "project" && from === "proposed" && to === "queued";
  if (effect === "recommendation_rejected") return from === "proposed" && to === "rejected";
  if (effect === "status_recorded") return from !== to && authorizedProgressTransition(scope, from, to);
  return effect === "status_migrated" && from === to && typeof item["previous_recommendation_id"] === "string" && typeof item["previous_source_id"] === "string" && typeof item["previous_source_analysis_id"] === "string" && (item["previous_recommendation_id"] !== item["recommendation_id"] || item["previous_source_id"] !== item["source_id"] || item["previous_source_analysis_id"] !== item["source_analysis_id"]);
}
function readRecommendationActivity(root, allowPendingMigration = false) {
  const activity = path15.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const raw = readExistingContainedText(root, activity);
  if (raw === null) return [];
  const records = [];
  const ids = /* @__PURE__ */ new Set();
  const statusByEvidence = /* @__PURE__ */ new Map();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`recommendation activity line ${index + 1} is not valid JSON`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`recommendation activity line ${index + 1} must be an object`);
    const item = parsed;
    if (!hasOnlyKeys(item, RECOMMENDATION_ACTIVITY_KEYS) || item["schema_version"] !== "guild.recommendation_activity.v1" || typeof item["activity_id"] !== "string" || !SAFE_ID.test(item["activity_id"]) || ids.has(item["activity_id"]) || typeof item["at"] !== "string" || !Number.isFinite(Date.parse(item["at"])) || typeof item["source_id"] !== "string" || !SAFE_ID.test(item["source_id"]) || typeof item["source_analysis_id"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["source_analysis_id"]) || typeof item["recommendation_id"] !== "string" || !SAFE_ID.test(item["recommendation_id"]) || item["previous_recommendation_id"] !== void 0 && (typeof item["previous_recommendation_id"] !== "string" || !SAFE_ID.test(item["previous_recommendation_id"])) || item["previous_source_id"] !== void 0 && (typeof item["previous_source_id"] !== "string" || !SAFE_ID.test(item["previous_source_id"])) || item["previous_source_analysis_id"] !== void 0 && (typeof item["previous_source_analysis_id"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["previous_source_analysis_id"])) || typeof item["evidence_signature"] !== "string" || !/^[a-f0-9]{64}$/.test(item["evidence_signature"]) || typeof item["scope"] !== "string" || !RECOMMENDATION_SCOPES.has(item["scope"]) || typeof item["from_status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["from_status"]) || typeof item["to_status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["to_status"]) || typeof item["effect"] !== "string" || !RECOMMENDATION_ACTIVITY_EFFECTS.has(item["effect"]) || !activitySemantics(item)) {
      throw new Error(`recommendation activity line ${index + 1} violates guild.recommendation_activity.v1`);
    }
    const chainKey = `${item["scope"]}:${item["evidence_signature"]}`;
    const expectedFrom = statusByEvidence.get(chainKey) ?? "proposed";
    if (item["from_status"] !== expectedFrom) {
      throw new Error(`recommendation activity line ${index + 1} breaks the authorized transition chain`);
    }
    statusByEvidence.set(chainKey, item["to_status"]);
    ids.add(item["activity_id"]);
    records.push(item);
  }
  if (!allowPendingMigration) {
    for (const [chainKey, status] of statusByEvidence) {
      void status;
      const latest = [...records].reverse().find((event) => `${event.scope}:${event.evidence_signature}` === chainKey);
      if (latest.source_analysis_id !== canonicalSourceAnalysisId(root, latest.source_id)) {
        throw new Error(`recommendation activity chain ${chainKey} is not bound to its current canonical source analysis`);
      }
    }
  }
  return records;
}
function recordRecommendationActivity(root, sourceId, item, fromStatus, effect, previousRecommendationId, previousSourceId, previousSourceAnalysisId, deferFinalValidation = false) {
  if (fromStatus === item.status && effect !== "status_migrated") return;
  const activity = path15.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const records = readRecommendationActivity(root, effect === "status_migrated");
  const at = (/* @__PURE__ */ new Date()).toISOString();
  const event = {
    schema_version: "guild.recommendation_activity.v1",
    activity_id: stableId("activity", `${at}|${crypto5.randomUUID()}|${sourceId}|${item.id}`),
    at,
    source_id: sourceId,
    source_analysis_id: canonicalSourceAnalysisId(root, sourceId),
    recommendation_id: item.id,
    ...previousRecommendationId ? { previous_recommendation_id: previousRecommendationId } : {},
    ...previousSourceId ? { previous_source_id: previousSourceId } : {},
    ...previousSourceAnalysisId ? { previous_source_analysis_id: previousSourceAnalysisId } : {},
    evidence_signature: item.evidence_signature,
    scope: item.scope,
    from_status: fromStatus,
    to_status: item.status,
    effect
  };
  records.push(event);
  atomicWrite2(root, activity, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  if (!deferFinalValidation) readRecommendationActivity(root);
}
function restoreRecommendationFile(root, file, previous) {
  if (previous === null) {
    assertOutputContained(root, file);
    try {
      fs12.unlinkSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return;
  }
  atomicWrite2(root, file, previous);
}
var TRANSACTION_JOURNAL_KEYS = /* @__PURE__ */ new Set(["schema_version", "transaction_id", "files"]);
var TRANSACTION_FILE_KEYS = /* @__PURE__ */ new Set(["path", "previous"]);
function isAnalyzerOwnedTransactionTarget(root, file) {
  const relative8 = path15.relative(path15.resolve(root), path15.resolve(file)).split(path15.sep).join("/");
  const parts = relative8.split("/");
  if (relative8 === ".guild/recommendations/queue.jsonl" || relative8 === ".guild/recommendations/activity.jsonl" || relative8 === ".guild/analysis/comparisons/index.json") return true;
  if (parts.length === 3 && parts[0] === ".guild" && parts[1] === "recommendations" && parts[2].endsWith(".jsonl") && SAFE_ID.test(parts[2].slice(0, -".jsonl".length))) return true;
  if (parts.length === 4 && parts[0] === ".guild" && parts[1] === "recommendations" && parts[2] === "drafts" && parts[3].endsWith(".md") && SAFE_ID.test(parts[3].slice(0, -3))) return true;
  if (parts.length === 5 && parts[0] === ".guild" && parts[1] === "analysis" && parts[2] === "runs" && SAFE_ID.test(parts[3]) && ["analysis.json", "analysis.md"].includes(parts[4])) return true;
  return parts.length === 5 && parts[0] === ".guild" && parts[1] === "analysis" && parts[2] === "comparisons" && SAFE_ID.test(parts[3]) && ["comparison.json", "comparison.md"].includes(parts[4]);
}
function assertAnalyzerOwnedTransactionTarget(root, file) {
  assertOutputContained(root, file);
  if (!isAnalyzerOwnedTransactionTarget(root, file)) {
    throw new Error(`recommendation transaction target is not analyzer-owned: ${file}`);
  }
}
function transactionJournalPath(root) {
  return path15.resolve(durableGuildDir(root), "recommendations", ".transaction.json");
}
function removeTransactionJournal(root) {
  const journal = transactionJournalPath(root);
  assertOutputContained(root, journal);
  try {
    fs12.unlinkSync(journal);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
function recoverPendingTransaction(root) {
  const journal = transactionJournalPath(root);
  const raw = readExistingContainedText(root, journal);
  if (raw === null) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("recommendation transaction journal is malformed");
  }
  const item = asRecord(parsed);
  if (!hasOnlyKeys(item, TRANSACTION_JOURNAL_KEYS) || item["schema_version"] !== "guild.recommendation_transaction.v1" || typeof item["transaction_id"] !== "string" || !SAFE_ID.test(item["transaction_id"]) || !Array.isArray(item["files"])) throw new Error("recommendation transaction journal violates guild.recommendation_transaction.v1");
  const restored = /* @__PURE__ */ new Set();
  const validated = [];
  for (const [index, value] of item["files"].entries()) {
    const entry = asRecord(value);
    if (!hasOnlyKeys(entry, TRANSACTION_FILE_KEYS) || typeof entry["path"] !== "string" || path15.isAbsolute(entry["path"]) || entry["path"].split(/[\\/]/).includes("..") || entry["previous"] !== null && typeof entry["previous"] !== "string") {
      throw new Error(`recommendation transaction journal file ${index + 1} is invalid`);
    }
    const file = path15.resolve(root, entry["path"]);
    assertAnalyzerOwnedTransactionTarget(root, file);
    if (file === journal || restored.has(file)) throw new Error("recommendation transaction journal contains a duplicate or self reference");
    restored.add(file);
    validated.push({ file, previous: entry["previous"] });
  }
  for (const entry of validated) restoreRecommendationFile(root, entry.file, entry.previous);
  removeTransactionJournal(root);
}
function withFileTransaction(root, files, action) {
  const journal = transactionJournalPath(root);
  const unique = [...new Set(files.map((file) => path15.resolve(file)))];
  if (unique.includes(journal)) throw new Error("transaction targets must not include the transaction journal");
  const record = {
    schema_version: "guild.recommendation_transaction.v1",
    transaction_id: stableId("transaction", `${(/* @__PURE__ */ new Date()).toISOString()}|${crypto5.randomUUID()}`),
    files: unique.map((file) => {
      assertAnalyzerOwnedTransactionTarget(root, file);
      return { path: path15.relative(path15.resolve(root), file), previous: readExistingContainedText(root, file) };
    })
  };
  atomicWrite2(root, journal, JSON.stringify(record, null, 2) + "\n");
  try {
    const result2 = action();
    removeTransactionJournal(root);
    return result2;
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of record.files) {
      try {
        restoreRecommendationFile(root, path15.resolve(root, entry.path), entry.previous);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length === 0) removeTransactionJournal(root);
    if (rollbackErrors.length > 0) throw new Error(`recommendation transaction failed and recovery is pending: ${rollbackErrors.join("; ")}`);
    throw error;
  }
}
function rewriteRecommendation(root, sourceId, recommendationId, status, effect) {
  assertSafeId(recommendationId, "recommendation id");
  const source = recommendationSourceFile(root, sourceId);
  const queue = path15.join(durableGuildDir(root), "recommendations", "queue.jsonl");
  const activity = path15.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const sourceBefore = readExistingContainedText(root, source);
  const queueBefore = readExistingContainedText(root, queue);
  const activityBefore = readExistingContainedText(root, activity);
  const records = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId));
  readRecommendationRecords(root, queue, false);
  readRecommendationActivity(root);
  const index = records.findIndex((item) => item.id === recommendationId);
  if (index === -1) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);
  const fromStatus = records[index].status;
  const updated = { ...records[index], status };
  records[index] = updated;
  try {
    writeRecommendationRecords(root, source, records);
    if (updated.scope === "project") upsertProjectQueue(root, [updated], true);
    recordRecommendationActivity(root, sourceId, updated, fromStatus, effect);
  } catch (error) {
    const rollbackErrors = [];
    for (const [file, previous] of [[source, sourceBefore], [queue, queueBefore], [activity, activityBefore]]) {
      try {
        restoreRecommendationFile(root, file, previous);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) throw new Error(`recommendation transaction failed and rollback was incomplete: ${rollbackErrors.join("; ")}`);
    throw error;
  }
  return updated;
}
var V14_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
var V14_PHASES = /* @__PURE__ */ new Set(["brainstorm", "team-compose", "plan", "context", "execute", "review", "verify", "reflect"]);
var V14_LOOPS = /* @__PURE__ */ new Set(["L1", "L2", "L3", "L4", "security-review", "L-arch"]);
var DEGRADATION_KINDS = /* @__PURE__ */ new Set([
  "coordination.parallelism",
  "backend_rung",
  "dispatch.deferred",
  "feature_degraded",
  "degraded_retrieval",
  "tier_degraded",
  "degraded_reason"
]);
var V14_TOOLS = /* @__PURE__ */ new Set([
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
var HOOK_MIRROR_EVENTS = /* @__PURE__ */ new Set([
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
  "TeammateIdle",
  "loop_round_start",
  "loop_round_end",
  "codex_review_round"
]);
var LIFECYCLE_TRACE_KEYS = /* @__PURE__ */ new Set(["schema_version", "event_id", "event_name", "run_id", "at"]);
var DEGRADATION_TRACE_KEYS = /* @__PURE__ */ new Set(["schema_version", "event_type", "kind", "run_id", "ts", "degradation"]);
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function integerAtLeast(value, minimum) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}
function strings(value, keys) {
  return keys.every((key) => nonEmptyString(value[key]));
}
function noNullFields(value) {
  return Object.values(value).every((field) => field !== null);
}
function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}
function optionalStrings(value, keys) {
  return keys.every((key) => !(key in value) || typeof value[key] === "string");
}
function optionalNonNegativeIntegers(value, keys) {
  return keys.every((key) => !(key in value) || integerAtLeast(value[key], 0));
}
function validTokenBlock(value) {
  if (value === void 0) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return ["input", "output", "cached", "cost_usd"].every(
    (key) => !(key in value) || typeof value[key] === "number" && Number.isFinite(value[key]) && Number(value[key]) >= 0
  );
}
function validCodexGate(value) {
  return typeof value === "string" && (["G-spec", "G-plan", "G-diagnose"].includes(value) || /^(?:G-lane):T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/.test(value));
}
function validV14Envelope(value, event) {
  return value["event"] === event && nonEmptyString(value["run_id"]) && typeof value["ts"] === "string" && V14_TIMESTAMP.test(value["ts"]);
}
function validateAnalyzerTraceRow(value) {
  const schema = value["schema_version"];
  if (schema === "guild.trace_event.v1") {
    const lifecycle = hasOnlyKeys(value, LIFECYCLE_TRACE_KEYS) && ["run_started", "run_closed"].includes(String(value["event_name"])) && strings(value, ["event_id", "run_id", "at"]) && ISO_TIMESTAMP.test(String(value["at"]));
    const degradationPayload = asRecord(value["degradation"]);
    const degradation = hasOnlyKeys(value, DEGRADATION_TRACE_KEYS) && value["event_type"] === "feature_degraded" && strings(value, ["kind", "run_id", "ts"]) && ISO_TIMESTAMP.test(String(value["ts"])) && DEGRADATION_KINDS.has(String(value["kind"])) && degradationPayload["kind"] === value["kind"];
    return { ok: lifecycle || degradation, implicitRun: false };
  }
  if (typeof schema === "string" && schema.startsWith("guild.trace.")) {
    if ("event" in value || "event_name" in value) return { ok: false, implicitRun: false };
    return { ok: validateGuildTraceEvent(value).ok, implicitRun: false };
  }
  if ("schema_version" in value) return { ok: false, implicitRun: false };
  if (!noNullFields(value)) return { ok: false, implicitRun: false };
  const event = value["event"];
  if (typeof event !== "string") return { ok: false, implicitRun: false };
  const isHookMirror = HOOK_MIRROR_EVENTS.has(event) && (event !== "loop_round_start" && event !== "loop_round_end" && event !== "codex_review_round" || !("run_id" in value));
  if (isHookMirror) {
    const common = typeof value["ts"] === "string" && V14_TIMESTAMP.test(value["ts"]) && typeof value["tool"] === "string" && typeof value["specialist"] === "string" && nonEmptyString(value["payload_digest"]) && typeof value["ok"] === "boolean" && integerAtLeast(value["ms"], 0) && optionalStrings(value, ["model", "prompt", "loop_layer", "loop_gate", "span_id", "parent_span_id", "tier", "payload_ref"]) && (!("loop_round" in value) || typeof value["loop_round"] === "number" && Number.isInteger(value["loop_round"])) && (!("loop_terminated" in value) || typeof value["loop_terminated"] === "boolean") && validTokenBlock(value["tokens"]);
    const details = event === "loop_round_start" ? V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["loop_round"], 1) : event === "loop_round_end" ? V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["loop_round"], 1) && typeof value["loop_terminated"] === "boolean" : event === "codex_review_round" ? validCodexGate(value["loop_gate"]) && integerAtLeast(value["loop_round"], 1) && typeof value["loop_terminated"] === "boolean" : true;
    const ok2 = common && details;
    return { ok: ok2, implicitRun: true };
  }
  if (!validV14Envelope(value, event)) return { ok: false, implicitRun: false };
  let ok = false;
  switch (event) {
    case "phase_start":
      ok = V14_PHASES.has(String(value["phase"]));
      break;
    case "phase_end":
      ok = V14_PHASES.has(String(value["phase"])) && integerAtLeast(value["duration_ms"], 0) && ["ok", "error", "escalated"].includes(String(value["status"]));
      break;
    case "specialist_dispatch":
      ok = strings(value, ["lane_id", "specialist", "task_id", "prompt_excerpt"]);
      break;
    case "specialist_receipt":
      ok = strings(value, ["lane_id", "specialist", "task_id", "receipt_path"]);
      break;
    case "loop_round_start":
      ok = nonEmptyString(value["lane_id"]) && V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["round_number"], 1) && integerAtLeast(value["cap"], 1) && Number(value["cap"]) <= 256;
      break;
    case "loop_round_end":
      ok = nonEmptyString(value["lane_id"]) && V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["round_number"], 1) && ["satisfied", "malformed_termination", "cap_hit", "escalation", "error"].includes(String(value["terminated"])) && nonEmptyString(value["terminator"]);
      break;
    case "tool_call":
      ok = V14_TOOLS.has(String(value["tool"])) && typeof value["command_redacted"] === "string" && ["ok", "err", "n/a"].includes(String(value["status"])) && integerAtLeast(value["latency_ms"], 0) && typeof value["result_excerpt_redacted"] === "string" && optionalStrings(value, ["lane_id"]) && optionalNonNegativeIntegers(value, ["tokens_in", "tokens_out"]);
      break;
    case "hook_event":
      ok = HOOK_MIRROR_EVENTS.has(String(value["hook_name"])) && typeof value["payload_excerpt_redacted"] === "string" && integerAtLeast(value["latency_ms"], 0) && ["ok", "err"].includes(String(value["status"])) && optionalStrings(value, ["lane_id"]);
      break;
    case "gate_decision":
      ok = typeof value["gate"] === "string" && (["gate-1-spec", "gate-2-team", "gate-3-plan"].includes(value["gate"]) || /^(?:mid-execution-decision):[a-z][a-z0-9-]{0,63}$/.test(value["gate"])) && ["approved", "rejected", "deferred"].includes(String(value["decision"])) && ["user", "auto-approve-mode"].includes(String(value["source"]));
      break;
    case "assumption_logged":
      ok = strings(value, ["lane_id", "specialist", "assumption_text"]);
      break;
    case "escalation":
      const offered = value["options_offered"];
      ok = ["cap_hit", "malformed_termination_x2", "restart_cap_hit"].includes(String(value["reason"])) && Array.isArray(offered) && ["force-pass", "extend-cap", "rework"].every((choice, index) => offered[index] === choice) && offered.length === 3 && ["force-pass", "extend-cap", "rework"].includes(String(value["user_choice"])) && optionalStrings(value, ["lane_id"]);
      break;
    case "codex_review_round":
      ok = validCodexGate(value["gate"]) && integerAtLeast(value["round_number"], 1) && Number(value["round_number"]) <= 5 && typeof value["terminated_by_satisfied"] === "boolean";
      break;
    default:
      ok = false;
  }
  return { ok, implicitRun: false };
}
function loadEvents(root, runId) {
  const dir = runDir(root, runId);
  const log = resolveRunInputFile(dir, path15.join("logs", "v1.4-events.jsonl"));
  const raw = log ? readText(log) ?? "" : "";
  const events = [];
  let parseErrors = 0;
  let invalidRecords = 0;
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        invalidRecords++;
        return;
      }
      const value = parsed;
      const validation = validateAnalyzerTraceRow(value);
      const eventRunId = value["run_id"];
      const sameRun = validation.implicitRun ? eventRunId === void 0 || eventRunId === runId : eventRunId === runId;
      if (!sameRun || !validation.ok) {
        invalidRecords++;
        return;
      }
      events.push({
        value,
        line: index + 1,
        ref: `.guild/runs/${runId}/logs/v1.4-events.jsonl#line:${index + 1}`
      });
    } catch {
      parseErrors++;
    }
  });
  return { events, raw, parseErrors, invalidRecords };
}
function readConfigSnapshot(file, runId) {
  if (!file) return null;
  const raw = readText(file);
  if (raw === null) return null;
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (parsed["schema_version"] !== "guild.plugin_config_snapshot.v1") return null;
    if (parsed["run_id"] !== runId) return null;
    if (typeof parsed["effective"] !== "object" || parsed["effective"] === null || Array.isArray(parsed["effective"])) return null;
    if (parsed["config_source_layers"] === void 0 || typeof parsed["config_source_layers"] !== "object" || parsed["config_source_layers"] === null || Array.isArray(parsed["config_source_layers"])) return null;
    const plugin = asRecord(parsed["plugin"]);
    if (!scalar(plugin, "version") || !scalar(plugin, "ref") || plugin["version"] === "unknown" || plugin["ref"] === "unknown") return null;
    const host = asRecord(parsed["host_adapter"]);
    if (!scalar(host, "requested") || !scalar(host, "resolved")) return null;
    const hashes = asRecord(parsed["registry_hashes"]);
    if (!("skills" in hashes) || !("agents" in hashes)) return null;
    if (!scalar(parsed, "command_surface_version")) return null;
    if (parsed["redaction_policy"] !== "scrubbed-config-v1") return null;
    if (typeof parsed["environment_capabilities"] !== "object" || parsed["environment_capabilities"] === null || Array.isArray(parsed["environment_capabilities"])) return null;
    return parsed;
  } catch {
    return null;
  }
}
var EVENT_CLASS_CATEGORY = Object.freeze({
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
function categoryOf(event) {
  const schema = event["schema_version"];
  if (schema === "guild.trace.analysis.v2") {
    const eventClass = event["event_class"];
    return EVENT_CLASS_CATEGORY[eventClass] ?? null;
  }
  if (schema === "guild.trace_event.v1") return event["event_name"] === "run_closed" ? "close" : null;
  if (schema === "guild.trace.dispatch.v1") return "agent";
  if (schema === "guild.trace.recall.v1") return "knowledge";
  if ("schema_version" in event) return null;
  if (event["event"] === "specialist_dispatch") return "agent";
  if (event["event"] === "tool_call") return "tool";
  if (event["event"] === "phase_start" || event["event"] === "phase_end") return "phase";
  if (event["event"] === "loop_round_start" || event["event"] === "loop_round_end") return "loop";
  if (event["event"] === "gate_decision" || event["event"] === "codex_review_round") return "gate";
  if (event["event"] === "UserPromptSubmit") return "prompt";
  return null;
}
function evidenceFor(events, category) {
  return events.filter((event) => categoryOf(event.value) === category).map((event) => event.ref);
}
function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function tokenUsage(events) {
  const specialists = /* @__PURE__ */ new Set();
  let input = 0;
  let output = 0;
  let cached = 0;
  let cost = 0;
  let llm = 0;
  let duration = 0;
  const semanticSpans = new Set(events.filter(({ value }) => value["schema_version"] === "guild.trace.analysis.v2").map(({ value }) => scalar(value, "span_id")).filter((value) => value !== null));
  for (const { value } of events) {
    const span = scalar(value, "span_id");
    if (value["schema_version"] !== "guild.trace.analysis.v2" && span && semanticSpans.has(span)) continue;
    const tokens = asRecord(value["tokens"]);
    const eventInput = numeric(tokens["input"]) + numeric(value["tokens_in"]);
    const eventOutput = numeric(tokens["output"]) + numeric(value["tokens_out"]);
    const eventCached = numeric(tokens["cached"]);
    const eventCost = numeric(tokens["cost_usd"]);
    input += eventInput;
    output += eventOutput;
    cached += eventCached;
    cost += eventCost;
    duration += numeric(value["duration_ms"]) + numeric(value["latency_ms"]);
    const specialist = scalar(value, "specialist") ?? scalar(value, "attribution_specialist") ?? (value["event_class"] === "agent_dispatched" ? scalar(value, "actor_id") : null);
    if (specialist) specialists.add(specialist);
    if (eventInput + eventOutput + eventCached > 0 || categoryOf(value) === "agent") llm++;
  }
  return {
    llm_event_count: llm,
    specialists_dispatched: [...specialists].sort(),
    tokens: { input, output, cached, total: input + output + cached, cost_usd: cost },
    duration_ms: duration
  };
}
function finding(analysisId, kind, severity, summary, evidenceRefs, signature) {
  return {
    id: stableId("finding", `${analysisId}|${kind}|${signature}`),
    kind,
    severity,
    summary,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
    signature
  };
}
var DIAGNOSTICS_CONTRACT = "C-DETECTORS/v1";
var HASH_REF = /^sha256:[a-f0-9]{64}$/;
var SIDECAR_MAX_BYTES = 1024 * 1024;
var LONG_LATENCY_MS = 3e4;
var OUTLIER_MIN_COHORT = 5;
var REPEAT_THRESHOLD = 2;
var SUBSTANTIVE_CLASSES = ["tool_call_started", "tool_call_finished", "tool_call_failed", "tool_call_denied", "agent_dispatched", "agent_prompt_sent"];
var RESULT_CLASSES = ["agent_response_received", "agent_handoff_written", "tool_call_finished", "tool_call_failed"];
var INPUT_CHANGE_CLASSES = ["prompt_received", "implementation_authorized", "config_snapshot_written"];
var DENIAL_CAUSES = ["policy", "user", "host_unavailable", "capability_absent"];
var PROJECT_CAPABILITY_KINDS = Object.freeze({
  skill: "create_skill",
  agent: "create_agent",
  workflow: "update_workflow",
  knowledge: "update_knowledge",
  settings: "change_settings"
});
var PLUGIN_CAPABILITY_KINDS = Object.freeze({
  plugin_behavior: "tooling_gap",
  plugin_invariant: "bug_report"
});
var SIDECAR_CARRIERS = Object.freeze({
  "guild.analysis_declaration.v1": ["run_started", "implementation_authorized"],
  "guild.instruction_evidence.v1": ["gate_concluded"],
  "guild.outcome_record.v1": ["gate_concluded"],
  "guild.capability_evidence.v1": ["tool_call_denied", "tool_call_failed"],
  "guild.lookup_result.v1": ["knowledge_lookup_result", "memory_lookup_result"],
  "guild.prompt_context.v1": ["prompt_normalized", "agent_prompt_sent"],
  "guild.phase_cursor.v1": ["run_closed", "phase_concluded"]
});
var SIDECAR_CARRIER_CLASSES = new Set(Object.values(SIDECAR_CARRIERS).flat());
var arrayOf = (value, test) => Array.isArray(value) && value.every(test);
var keysOf = (...keys) => /* @__PURE__ */ new Set(["schema_version", "run_id", ...keys]);
var hashRef = (value) => typeof value === "string" && HASH_REF.test(value);
var runEvidenceRef = (runId) => (value) => typeof value === "string" && validEvidenceRef(value) && evidenceRunId(value) === runId;
var SIDECAR_VALIDATORS = Object.freeze({
  "guild.analysis_declaration.v1": (v) => {
    const instructions = Array.isArray(v["instructions"]) ? v["instructions"].map(asRecord) : null;
    return hasOnlyKeys(v, keysOf("assessed_input_hash", "assessed_input_ref", "instructions", "instructions_complete", "clarification_required_tasks", "required_phases")) && hashRef(v["assessed_input_hash"]) && nonEmptyString(v["assessed_input_ref"]) && instructions !== null && instructions.every((item) => hasOnlyKeys(item, /* @__PURE__ */ new Set(["instruction_id", "requirement_hash"])) && typeof item["instruction_id"] === "string" && SAFE_ID.test(item["instruction_id"]) && hashRef(item["requirement_hash"])) && new Set(instructions.map((item) => item["instruction_id"])).size === instructions.length && typeof v["instructions_complete"] === "boolean" && arrayOf(v["clarification_required_tasks"], nonEmptyString) && arrayOf(v["required_phases"], nonEmptyString);
  },
  "guild.instruction_evidence.v1": (v, runId) => hasOnlyKeys(v, keysOf("instruction_id", "requirement_hash", "verifier_kind", "verifier_ref", "result", "verified_input_hash", "verification_input_ref", "evidence_refs")) && typeof v["instruction_id"] === "string" && SAFE_ID.test(v["instruction_id"]) && hashRef(v["requirement_hash"]) && ["done_when", "configured_check", "review_gate"].includes(String(v["verifier_kind"])) && runEvidenceRef(runId)(v["verifier_ref"]) && ["passed", "failed", "unobservable"].includes(String(v["result"])) && hashRef(v["verified_input_hash"]) && nonEmptyString(v["verification_input_ref"]) && arrayOf(v["evidence_refs"], runEvidenceRef(runId)),
  "guild.outcome_record.v1": (v) => hasOnlyKeys(v, keysOf("kind", "result", "verified_input_hash", "reopen_transitions", "findings_complete", "unresolved_finding_ids")) && ["review", "verify"].includes(String(v["kind"])) && ["passed", "failed"].includes(String(v["result"])) && hashRef(v["verified_input_hash"]) && integerAtLeast(v["reopen_transitions"], 0) && typeof v["findings_complete"] === "boolean" && arrayOf(v["unresolved_finding_ids"], (id) => typeof id === "string" && SAFE_ID.test(id)),
  "guild.capability_evidence.v1": (v, runId) => hasOnlyKeys(v, keysOf("action_signature", "owner", "capability_kind", "target", "evidence_refs")) && typeof v["action_signature"] === "string" && /^\S{1,256}$/.test(v["action_signature"]) && (v["owner"] === "project" && String(v["capability_kind"]) in PROJECT_CAPABILITY_KINDS || v["owner"] === "plugin" && String(v["capability_kind"]) in PLUGIN_CAPABILITY_KINDS) && typeof v["target"] === "string" && SAFE_ID.test(v["target"]) && arrayOf(v["evidence_refs"], runEvidenceRef(runId)),
  "guild.lookup_result.v1": (v, runId) => hasOnlyKeys(v, keysOf("outcome", "result_ref")) && ["hit", "miss"].includes(String(v["outcome"])) && runEvidenceRef(runId)(v["result_ref"]),
  "guild.prompt_context.v1": (v) => hasOnlyKeys(v, keysOf("prompt_hash", "context_hash", "retry_authorized")) && nonEmptyString(v["prompt_hash"]) && hashRef(v["context_hash"]) && typeof v["retry_authorized"] === "boolean",
  "guild.phase_cursor.v1": (v) => hasOnlyKeys(v, keysOf("visited_phases", "bypassed_phases")) && arrayOf(v["visited_phases"], nonEmptyString) && arrayOf(v["bypassed_phases"], nonEmptyString)
});
function canonicalJson2(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson2).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sortedUnique(values) {
  return [...new Set(values)].sort();
}
function readAdditiveInput(store, dir, runId, relative8) {
  const text = typeof relative8 === "string" ? relative8 : "";
  const candidate = text && !path15.isAbsolute(text) && !text.includes("#") ? `.guild/runs/${runId}/${text}` : "";
  const ref = candidate && validEvidenceRef(candidate) && evidenceRunId(candidate) === runId ? candidate : `invalid-ref:${sha2563(String(relative8)).slice(0, 16)}`;
  const existing = store.get(ref);
  if (existing) return existing;
  let input = { entry: { ref, sha256: null, status: "rejected" }, bytes: null };
  if (ref.startsWith(".guild/")) {
    let file = null;
    let unsafe = false;
    try {
      file = resolveRunInputFile(dir, text);
    } catch {
      unsafe = true;
    }
    if (!unsafe && file === null) input = { entry: { ref, sha256: null, status: "missing" }, bytes: null };
    if (!unsafe && file !== null && fs12.statSync(file).size <= SIDECAR_MAX_BYTES) {
      const bytes = fs12.readFileSync(file, "utf8");
      input = { entry: { ref, sha256: `sha256:${sha2563(bytes)}`, status: "consumed" }, bytes };
    }
  }
  store.set(ref, input);
  return input;
}
function readSidecars(store, dir, runId, events) {
  const sidecars = [];
  for (const event of events) {
    const value = event.value;
    if (value["schema_version"] !== "guild.trace.analysis.v2" || value["payload_ref"] === void 0 || !SIDECAR_CARRIER_CLASSES.has(String(value["event_class"]))) continue;
    const input = readAdditiveInput(store, dir, runId, value["payload_ref"]);
    if (input.bytes === null) continue;
    let record;
    try {
      record = asRecord(JSON.parse(input.bytes));
    } catch {
      if (input.entry.status === "consumed") input.entry.status = "unrecognized";
      continue;
    }
    const schema = String(record["schema_version"]);
    const validator = SIDECAR_VALIDATORS[schema];
    if (!validator) {
      if (input.entry.status === "consumed") input.entry.status = "unrecognized";
      continue;
    }
    if (record["run_id"] !== runId || !SIDECAR_CARRIERS[schema].includes(String(value["event_class"])) || !validator(record, runId)) {
      input.entry.status = "rejected";
      continue;
    }
    sidecars.push({ ref: input.entry.ref, schema, value: record, carrier: event });
  }
  return sidecars;
}
function actionGroups(events, runId) {
  const byRef = new Map(events.map((event) => [event.ref, event]));
  return collapseSpanTwins(events, runId).map((action) => {
    const rows = action.refs.map((ref) => byRef.get(ref)).filter((row) => row !== void 0).sort((a, b) => a.line - b.line);
    return { rows, refs: [...action.refs], line: rows[0]?.line ?? 0 };
  }).filter((group) => group.rows.length > 0).sort((a, b) => a.line - b.line);
}
var classOf = (event) => event.value["schema_version"] === "guild.trace.analysis.v2" ? String(event.value["event_class"]) : "";
var groupHas = (group, classes) => group.rows.some((row) => classes.includes(classOf(row)));
var rowsOf = (group, classes) => group.rows.filter((row) => classes.includes(classOf(row)));
function groupField(group, key) {
  for (const row of group.rows) {
    const value = scalar(row.value, key);
    if (value !== null) return value;
  }
  return null;
}
function rowTime(event) {
  const value = scalar(event.value, "ts") ?? scalar(event.value, "at");
  return value === null ? Number.NaN : Date.parse(value);
}
var isLegacyToolFailure = (event) => event.value["event"] === "tool_call" && event.value["status"] === "err";
var isFailureRow = (event) => isLegacyToolFailure(event) || ["tool_call_failed", "repeated_failure_detected"].includes(classOf(event));
function failureSignature(group) {
  const typed = group.rows.filter((row) => classOf(row) !== "");
  for (const row of [...typed.filter(isFailureRow), ...typed]) {
    const signature = scalar(row.value, "signature");
    if (signature !== null) return signature;
  }
  const legacy = group.rows.find(isLegacyToolFailure);
  return legacy ? [legacy.value["tool"], legacy.value["command_redacted"], legacy.value["result_excerpt_redacted"]].map(String).join("|") : null;
}
function toolActionKey(group) {
  const denied = rowsOf(group, ["tool_call_denied"])[0];
  if (denied) return String(denied.value["signature"]).split(":").slice(1).join(":") || null;
  for (const row of group.rows) {
    if (classOf(row) !== "" && scalar(row.value, "signature") !== null) return scalar(row.value, "signature");
  }
  const legacy = group.rows.find((row) => row.value["event"] === "tool_call");
  return legacy ? toolActionSignature(String(legacy.value["tool"]), String(legacy.value["command_redacted"])) : null;
}
function result(detector, state, value, refs, reason) {
  return { detector, state, value, evidence_refs: sortedUnique(refs), reason };
}
function boundInput(ctx, claimed, inputRef) {
  if (!ctx.declaration || claimed !== ctx.declaration.value["assessed_input_hash"]) return { bound: false, ref: null };
  if (inputRef === void 0) return { bound: true, ref: null };
  const input = readAdditiveInput(ctx.store, ctx.dir, ctx.runId, inputRef);
  return { bound: input.bytes !== null && input.entry.sha256 === claimed, ref: input.entry.ref };
}
function verifierCorroborates(ctx, sidecar) {
  const proof = sidecar.value;
  const verifier = ctx.events.find((event) => event.ref === proof["verifier_ref"]);
  if (!verifier || classOf(verifier) !== "gate_concluded") return false;
  const bound = verifier.ref === sidecar.carrier.ref || ctx.sidecars.some((other) => other.schema === "guild.instruction_evidence.v1" && other.carrier.ref === verifier.ref && other.value["instruction_id"] === proof["instruction_id"] && other.value["requirement_hash"] === proof["requirement_hash"] && other.value["verified_input_hash"] === proof["verified_input_hash"]);
  if (!bound) return false;
  return proof["result"] === "passed" && verifier.value["status"] === "ok" || proof["result"] === "failed" && verifier.value["status"] === "error";
}
function instructionProofs(ctx) {
  return ctx.sidecars.filter((item) => item.schema === "guild.instruction_evidence.v1").map((sidecar) => {
    const proof = sidecar.value;
    const binding = boundInput(ctx, proof["verified_input_hash"], proof["verification_input_ref"]);
    const valid = proof["result"] !== "unobservable" && binding.bound && verifierCorroborates(ctx, sidecar);
    return { sidecar, valid, refs: sortedUnique([sidecar.ref, String(proof["verifier_ref"]), ...binding.ref ? [binding.ref] : []]) };
  });
}
function detectInstructionFollowing(ctx) {
  const proofs = instructionProofs(ctx);
  const declared = ctx.declaration ? ctx.declaration.value["instructions"] : [];
  const violationRows = ctx.events.filter((event) => classOf(event) === "instruction_violation_detected");
  const checks = declared.map((item) => {
    const mine = proofs.filter(({ sidecar }) => sidecar.value["instruction_id"] === item.instruction_id && sidecar.value["requirement_hash"] === item.requirement_hash);
    const passed = mine.filter((proof) => proof.valid && proof.sidecar.value["result"] === "passed");
    const failed2 = mine.filter((proof) => proof.valid && proof.sidecar.value["result"] === "failed");
    const violations = violationRows.filter((event) => [item.instruction_id, `instruction:${item.instruction_id}`].includes(String(event.value["signature"])));
    const status = failed2.length > 0 || violations.length > 0 ? "violated" : passed.length > 0 ? "satisfied" : mine.length > 0 ? "ambiguous" : "unobservable";
    return {
      instruction_id: item.instruction_id,
      requirement_hash: item.requirement_hash,
      status,
      evidence_refs: sortedUnique([...violations.map((event) => event.ref), ...mine.flatMap((proof) => proof.sidecar.value["evidence_refs"])]),
      proof_refs: sortedUnique(mine.flatMap((proof) => proof.refs))
    };
  }).sort((a, b) => a.instruction_id.localeCompare(b.instruction_id));
  const typedViolationRefs = checks.filter((check) => check.status === "violated").flatMap((check) => [...check.evidence_refs, ...check.proof_refs]);
  const complete = ctx.declaration !== null && ctx.declaration.value["instructions_complete"] === true && checks.length > 0;
  const aggregate = typedViolationRefs.length > 0 || ctx.v1ViolationRefs.length > 0 ? "violated" : complete && checks.every((check) => check.status === "satisfied") ? "satisfied" : ctx.instructionObservableRefs.length > 0 || proofs.length > 0 ? "ambiguous" : "unobservable";
  const satisfiedRefs = aggregate === "satisfied" ? checks.flatMap((check) => [...check.evidence_refs, ...check.proof_refs, ctx.declaration.ref]) : [];
  const counts = Object.fromEntries(["satisfied", "violated", "ambiguous", "unobservable"].map((status) => [status, checks.filter((check) => check.status === status).length]));
  const reason = aggregate === "satisfied" || aggregate === "violated" ? null : ctx.declaration === null ? ctx.declarationReason ?? "no_instruction_declaration" : !complete ? "declared_scope_incomplete" : "missing_typed_proof";
  return {
    result: result("instruction_following", aggregate === "satisfied" || aggregate === "violated" ? "observed" : aggregate === "ambiguous" ? "ambiguous" : "unobservable", {
      aggregate,
      declared: checks.length,
      declared_complete: complete,
      counts,
      requirement_hashes: sortedUnique(checks.map((check) => check.requirement_hash))
    }, [...typedViolationRefs, ...ctx.v1ViolationRefs, ...satisfiedRefs, ...aggregate === "ambiguous" ? ctx.instructionObservableRefs : []], reason),
    checks,
    aggregate,
    typedViolationRefs,
    satisfiedRefs
  };
}
function detectRepeatedMistake(ctx, proofs) {
  const attempts = [];
  let unsignatured = 0;
  for (const group of ctx.groups) {
    if (group.rows.some(isFailureRow)) {
      const signature = failureSignature(group);
      if (signature === null) unsignatured++;
      else attempts.push({ signature, task: groupField(group, "task_id"), phase: groupField(group, "phase"), refs: group.refs, source: "failed_action" });
    } else if (groupHas(group, ["correction_applied"])) {
      attempts.push({ signature: groupField(group, "signature"), task: groupField(group, "task_id"), phase: groupField(group, "phase"), refs: group.refs, source: "correction_applied" });
    }
  }
  const verifierAttempts = /* @__PURE__ */ new Map();
  for (const proof of proofs.filter((item) => item.valid && item.sidecar.value["result"] === "failed")) {
    const signature = `instruction:${String(proof.sidecar.value["instruction_id"])}`;
    const group = ctx.groups.find((candidate) => candidate.refs.includes(proof.sidecar.carrier.ref));
    const key = `${signature}|${group ? group.refs[0] : proof.sidecar.carrier.ref}`;
    const prior = verifierAttempts.get(key);
    if (prior) {
      prior.refs = sortedUnique([...prior.refs, ...proof.refs]);
      continue;
    }
    verifierAttempts.set(key, { signature, task: scalar(proof.sidecar.carrier.value, "task_id"), phase: scalar(proof.sidecar.carrier.value, "phase"), refs: [...proof.refs], source: "failed_verifier" });
  }
  attempts.push(...verifierAttempts.values());
  const clusters = /* @__PURE__ */ new Map();
  for (const attempt of attempts) {
    const key = `${attempt.signature}|${attempt.task ?? "-"}|${attempt.phase ?? "-"}`;
    clusters.set(key, [...clusters.get(key) ?? [], attempt]);
  }
  const repeated = [...clusters.values()].filter((items) => items.length >= REPEAT_THRESHOLD).map((items) => ({
    signature: items[0].signature,
    task_id: items[0].task,
    phase: items[0].phase,
    attempts: items.length,
    sources: sortedUnique(items.map((item) => item.source)),
    refs: sortedUnique(items.flatMap((item) => item.refs))
  })).sort((a, b) => `${a.signature}|${a.task_id}|${a.phase}`.localeCompare(`${b.signature}|${b.task_id}|${b.phase}`));
  const state = attempts.length > 0 ? "observed" : "unobservable";
  const findings = repeated.filter((item) => item.sources.includes("failed_verifier")).map((item) => ({
    kind: "repeated_failure",
    severity: "high",
    summary: `The same failed verification recurred ${item.attempts} times.`,
    evidence_refs: item.refs,
    signature: item.signature
  }));
  return {
    findings,
    result: result(
      "repeated_mistake",
      state,
      { clusters: repeated, signed_attempts: attempts.length, unsignatured_failures: unsignatured },
      repeated.flatMap((item) => item.refs),
      state === "observed" ? null : unsignatured > 0 ? "absent_action_signature" : "no_failure_or_correction_evidence"
    )
  };
}
function detectSteering(ctx) {
  const interventions = ctx.groups.filter((group) => groupHas(group, ["user_steering_received"]));
  const bySignature = {};
  for (const group of interventions) {
    const signature = groupField(group, "signature") ?? "unknown";
    bySignature[signature] = (bySignature[signature] ?? 0) + 1;
  }
  return {
    result: result("steering", interventions.length > 0 ? "observed" : "unobservable", {
      interventions: interventions.length,
      by_signature: Object.fromEntries(Object.entries(bySignature).sort(([a], [b]) => a.localeCompare(b))),
      repeated: interventions.length >= REPEAT_THRESHOLD,
      necessity: "unobservable"
    }, interventions.flatMap((group) => group.refs), interventions.length > 0 ? null : "no_steering_classification")
  };
}
function firstSubstantive(ctx, after, matches, before = Number.POSITIVE_INFINITY) {
  return ctx.groups.find((group) => group.line > after && group.line < before && groupHas(group, SUBSTANTIVE_CLASSES) && matches(group)) ?? null;
}
function detectClarification(ctx) {
  const required = new Set(ctx.declaration ? ctx.declaration.value["clarification_required_tasks"] : []);
  const clarifications = ctx.groups.filter((group) => groupHas(group, ["clarifying_question_asked"]));
  const pairs = [];
  const findings = [];
  const refs = [];
  for (const group of clarifications) {
    const task = groupField(group, "task_id");
    const action = task === null ? null : firstSubstantive(ctx, 0, (candidate) => groupField(candidate, "task_id") === task);
    const order = task === null ? "uncorrelated" : action === null ? "no_action" : action.line < group.line ? "action_first" : "clarification_first";
    const declared = task !== null && required.has(task);
    const timing = !declared || order === "uncorrelated" ? "unknown" : order === "action_first" ? "late" : "timely";
    pairs.push({ task_id: task, order, constraint: declared ? "declared" : "undeclared", timing });
    if (timing === "unknown") continue;
    const evidence = [...group.refs, ...action?.refs ?? [], ctx.declaration.ref];
    refs.push(...evidence);
    if (timing === "late") {
      findings.push({ kind: "prompt_inefficiency", severity: "low", summary: `A required clarification for task ${task} was asked after the first substantive action.`, evidence_refs: sortedUnique(evidence), signature: `late-clarification:${task}` });
    }
  }
  const count = (timing) => pairs.filter((pair) => pair.timing === timing).length;
  const state = count("late") + count("timely") > 0 ? "observed" : pairs.length > 0 ? "ambiguous" : "unobservable";
  return {
    result: result(
      "clarification",
      state,
      { timely: count("timely"), late: count("late"), unknown: count("unknown"), pairs },
      state === "ambiguous" ? clarifications.flatMap((group) => group.refs) : refs,
      state === "observed" ? null : state === "ambiguous" ? "no_declared_clarification_constraint" : "no_clarification_correlation"
    ),
    findings
  };
}
function detectRedundantPrompt(ctx) {
  const contexts = new Map(ctx.sidecars.filter((item) => item.schema === "guild.prompt_context.v1").map((item) => [item.carrier.ref, item]));
  const prompts = ctx.groups.filter((group) => groupHas(group, ["prompt_normalized", "agent_prompt_sent"]));
  const last = /* @__PURE__ */ new Map();
  const candidates = /* @__PURE__ */ new Map();
  let unkeyed = 0;
  for (const group of prompts) {
    const row = rowsOf(group, ["prompt_normalized", "agent_prompt_sent"])[0];
    const context = contexts.get(row.ref);
    const promptHash = scalar(row.value, "prompt_hash");
    const task = groupField(group, "task_id");
    const phase = groupField(group, "phase");
    if (!context || context.value["prompt_hash"] !== promptHash || task === null || phase === null) {
      unkeyed++;
      continue;
    }
    const key = sha2563(canonicalJson2([promptHash, task, phase, context.value["context_hash"]])).slice(0, 16);
    const prior = last.get(key);
    last.set(key, group);
    if (!prior || context.value["retry_authorized"] === true) continue;
    const intervening = ctx.groups.some((candidate) => candidate.line > prior.line && candidate.line < group.line && groupHas(candidate, RESULT_CLASSES) && [null, task].includes(groupField(candidate, "task_id")));
    if (intervening) continue;
    candidates.set(key, sortedUnique([...candidates.get(key) ?? [], ...prior.refs, ...group.refs, context.ref]));
  }
  const clusters = [...candidates.entries()].map(([key, refs]) => ({ signature: `redundant-prompt:${key}`, refs })).sort((a, b) => a.signature.localeCompare(b.signature));
  const keyed = prompts.length - unkeyed;
  return {
    result: result(
      "redundant_prompt",
      keyed > 0 ? "observed" : "unobservable",
      { prompts: prompts.length, keyed, unkeyed, candidates: clusters.map((item) => item.signature) },
      clusters.flatMap((item) => item.refs),
      keyed > 0 ? null : prompts.length > 0 ? "missing_context_hash" : "no_normalized_prompts"
    ),
    findings: clusters.map((item) => ({ kind: "prompt_inefficiency", severity: "low", summary: "An identical prompt was resent against unchanged bound inputs without an intervening result.", evidence_refs: item.refs, signature: item.signature }))
  };
}
function detectPromptActionLatency(ctx) {
  const samples = [];
  const refs = [];
  let long = 0;
  let waits = 0;
  let malformed = 0;
  for (const group of ctx.groups.filter((candidate) => groupHas(candidate, ["prompt_received", "agent_prompt_sent"]))) {
    const prompt = rowsOf(group, ["prompt_received", "agent_prompt_sent"])[0];
    const span = scalar(prompt.value, "span_id");
    if (span === null) continue;
    const correlated = (candidate) => candidate.rows.some((row) => scalar(row.value, "parent_span_id") === span);
    const action = firstSubstantive(ctx, group.line, correlated);
    if (!action) continue;
    if (ctx.groups.some((candidate) => candidate.line > group.line && candidate.line < action.line && groupHas(candidate, ["clarifying_question_asked"]) && correlated(candidate))) {
      waits++;
      continue;
    }
    const elapsed = rowTime(action.rows[0]) - rowTime(prompt);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      malformed++;
      continue;
    }
    samples.push(elapsed);
    if (elapsed > LONG_LATENCY_MS) {
      long++;
      refs.push(prompt.ref, ...action.refs);
    }
  }
  const state = samples.length + waits > 0 ? "observed" : "unobservable";
  return {
    result: result("prompt_action_latency", state, {
      pairs: samples.length,
      samples_ms: samples.sort((a, b) => a - b),
      long_latency: long,
      excluded_waits: waits,
      malformed,
      threshold_ms: LONG_LATENCY_MS
    }, refs, state === "observed" ? null : malformed > 0 ? "malformed_timestamps" : "no_correlated_prompt_action")
  };
}
function detectWorkflowChurn(ctx) {
  const findings = [];
  const capRefs = [
    ...ctx.groups.filter((group) => groupHas(group, ["loop_cap_hit"])).flatMap((group) => group.refs),
    ...ctx.events.filter((event) => event.value["event"] === "loop_round_end" && event.value["terminated"] === "cap_hit").map((event) => event.ref)
  ];
  const loopRows = ctx.events.filter((event) => categoryOf(event.value) === "loop");
  const entries = ctx.events.filter((event) => classOf(event) === "phase_entered" || event.value["event"] === "phase_start");
  const exits = ctx.events.filter((event) => classOf(event) === "phase_concluded" || event.value["event"] === "phase_end");
  const reentries = {};
  const reentryRefs = [];
  for (const entry of entries) {
    const phase = scalar(entry.value, "phase");
    if (exits.some((exit) => exit.line < entry.line && scalar(exit.value, "phase") === phase)) {
      reentries[phase] = (reentries[phase] ?? 0) + 1;
      reentryRefs.push(entry.ref);
    }
  }
  const repeatedLoops = Object.keys(reentries).filter((phase) => reentries[phase] >= REPEAT_THRESHOLD).sort();
  const requiredPhases = ctx.declaration ? ctx.declaration.value["required_phases"] : [];
  const entered = new Set(entries.map((entry) => scalar(entry.value, "phase")));
  const finalClose = ctx.events.filter((event) => categoryOf(event.value) === "close").sort((a, b) => b.line - a.line)[0] ?? null;
  const cursor = ctx.sidecars.find((item) => item.schema === "guild.phase_cursor.v1" && item.carrier.ref === finalClose?.ref) ?? null;
  const closed = ctx.declaration !== null && ctx.closeRefs.length > 0;
  const missing = closed ? sortedUnique(requiredPhases.filter((phase) => !entered.has(phase))) : [];
  const skipped = cursor ? missing.filter((phase) => cursor.value["bypassed_phases"].includes(phase) || !cursor.value["visited_phases"].includes(phase)) : [];
  const unconfirmed = missing.filter((phase) => !skipped.includes(phase));
  for (const phase of skipped) {
    findings.push({ kind: "workflow_churn", severity: "medium", summary: `Required phase ${phase} was never entered before the run closed.`, evidence_refs: sortedUnique([ctx.declaration.ref, ...ctx.closeRefs, cursor.ref, cursor.carrier.ref]), signature: `skipped-phase:${phase}` });
  }
  const proposals = ctx.groups.filter((group) => groupHas(group, ["recommendation_created"]));
  const repeatedProposals = /* @__PURE__ */ new Map();
  const lastProposal = /* @__PURE__ */ new Map();
  for (const group of proposals) {
    const signature = groupField(group, "signature");
    const prior = lastProposal.get(signature);
    lastProposal.set(signature, group);
    if (!prior || ctx.groups.some((candidate) => candidate.line > prior.line && candidate.line < group.line && groupHas(candidate, INPUT_CHANGE_CLASSES))) continue;
    repeatedProposals.set(signature, sortedUnique([...repeatedProposals.get(signature) ?? [], ...prior.refs, ...group.refs]));
  }
  const dimensionStates = {
    loops: loopRows.length > 0 ? "observed" : "unobservable",
    phases: entries.length > 0 && exits.length > 0 ? "observed" : "unobservable",
    skipped_phases: closed && cursor ? "observed" : "unobservable",
    proposals: proposals.length > 0 ? "observed" : "unobservable"
  };
  const observed = Object.values(dimensionStates).includes("observed");
  return {
    result: result(
      "workflow_churn",
      observed ? "observed" : "unobservable",
      {
        cap_hits: capRefs.length,
        phase_reentries: Object.fromEntries(Object.entries(reentries).sort(([a], [b]) => a.localeCompare(b))),
        repeated_phase_loops: repeatedLoops,
        skipped_required_phases: skipped,
        unconfirmed_missing_phases: unconfirmed,
        repeated_proposals: [...repeatedProposals.keys()].sort(),
        dimension_states: dimensionStates
      },
      [...capRefs, ...repeatedLoops.length > 0 ? reentryRefs : [], ...findings.flatMap((item) => item.evidence_refs), ...[...repeatedProposals.values()].flat()],
      observed ? null : "missing_phase_loop_or_proposal_evidence"
    ),
    findings
  };
}
function detectKnowledgeMemory(ctx, proofs) {
  const consumed = new Set(proofs.filter((proof) => proof.valid && proof.sidecar.value["result"] === "passed").flatMap((proof) => proof.sidecar.value["evidence_refs"]));
  const refs = [];
  const summary = (kind) => {
    const lookups2 = ctx.groups.filter((group) => groupHas(group, [`${kind}_lookup_started`, `${kind}_lookup_result`])).length;
    const outcomes = ctx.sidecars.filter((item) => item.schema === "guild.lookup_result.v1" && classOf(item.carrier) === `${kind}_lookup_result`);
    const hits = outcomes.filter((item) => item.value["outcome"] === "hit");
    const links2 = hits.filter((item) => consumed.has(String(item.value["result_ref"])));
    refs.push(...links2.flatMap((item) => [item.ref, item.carrier.ref, String(item.value["result_ref"])]));
    return { lookups: lookups2, typed_results: outcomes.length, hits: hits.length, misses: outcomes.length - hits.length, use_links: links2.length };
  };
  const knowledge = summary("knowledge");
  const memory = summary("memory");
  const links = knowledge.use_links + memory.use_links;
  const typed = knowledge.typed_results + memory.typed_results;
  const lookups = knowledge.lookups + memory.lookups;
  const state = links > 0 ? "observed" : typed > 0 ? "ambiguous" : "unobservable";
  return {
    result: result(
      "knowledge_memory",
      state,
      { knowledge, memory },
      refs,
      state === "observed" ? null : typed > 0 ? "no_result_consumption_link" : lookups > 0 ? "no_typed_lookup_outcome" : "no_lookup_evidence"
    )
  };
}
function detectToolCoverage(ctx) {
  const toolGroups = ctx.groups.filter((group) => group.rows.some((row) => categoryOf(row.value) === "tool"));
  const denials = Object.fromEntries(DENIAL_CAUSES.map((cause) => [cause, 0]));
  const outcomes = { ok: 0, failed: 0, denied: 0, started_only: 0 };
  const attempts = /* @__PURE__ */ new Map();
  for (const group of toolGroups) {
    const denial = rowsOf(group, ["tool_call_denied"])[0];
    if (denial) {
      outcomes.denied++;
      const cause = String(denial.value["signature"]).split(":", 1)[0];
      denials[cause] = (denials[cause] ?? 0) + 1;
      if (cause !== "capability_absent") continue;
    } else if (group.rows.some(isFailureRow)) outcomes.failed++;
    else if (groupHas(group, ["tool_call_finished"]) || group.rows.some((row) => row.value["event"] === "tool_call")) {
      outcomes.ok++;
      continue;
    } else {
      outcomes.started_only++;
      continue;
    }
    const key = toolActionKey(group);
    if (key !== null) attempts.set(key, [...attempts.get(key) ?? [], group]);
  }
  const evidence = ctx.sidecars.filter((item) => item.schema === "guild.capability_evidence.v1");
  const candidates = [];
  const supported = [];
  const findings = [];
  const supportedOnly = [];
  const owned = /* @__PURE__ */ new Set();
  for (const item of evidence) {
    const signature = String(item.value["action_signature"]);
    const groups = attempts.get(signature) ?? [];
    if (!groups.some((group) => group.refs.includes(item.carrier.ref))) continue;
    owned.add(signature);
    const owner = item.value["owner"];
    const capability = String(item.value["capability_kind"]);
    const target = String(item.value["target"]);
    const refs = sortedUnique([...groups.flatMap((group) => group.refs), item.ref, ...item.value["evidence_refs"]]);
    if (groups.length < REPEAT_THRESHOLD) continue;
    if (capability === "plugin_invariant") {
      supportedOnly.push({ scope: "plugin", kind: "bug_report", target, severity: "high", summary: `Plugin-owned invariant ${target} failed during action ${signature}.`, evidence_refs: refs });
      continue;
    }
    const kind = owner === "project" ? PROJECT_CAPABILITY_KINDS[capability] : PLUGIN_CAPABILITY_KINDS[capability];
    candidates.push({ action_signature: signature, owner, capability_kind: capability, target, attempts: groups.length });
    const summary = `Action ${signature} failed ${groups.length} times and typed evidence names missing ${owner} capability ${target}.`;
    supported.push({ scope: owner, kind, target, severity: "medium", summary, evidence_refs: refs });
    findings.push({ kind: "tool_gap", severity: "medium", summary, evidence_refs: refs, signature: `tool-gap:${owner}:${capability}:${target}` });
  }
  const unowned = [...attempts.keys()].filter((key) => !owned.has(key)).length;
  return {
    result: result(
      "tool_coverage",
      toolGroups.length > 0 ? "observed" : "unobservable",
      {
        actions: toolGroups.length,
        outcomes,
        denials,
        gap_candidates: candidates.sort((a, b) => String(a["action_signature"]).localeCompare(String(b["action_signature"]))),
        gap_cause: candidates.length > 0 ? "observed" : "unobservable"
      },
      [...findings.flatMap((item) => item.evidence_refs), ...toolGroups.filter((group) => groupHas(group, ["tool_call_denied"])).flatMap((group) => group.refs)],
      toolGroups.length > 0 ? null : "no_tool_actions"
    ),
    findings,
    supported,
    supportedOnly,
    unowned
  };
}
function detectOutcomeQuality(ctx) {
  const records = ctx.sidecars.filter((item) => item.schema === "guild.outcome_record.v1");
  const bound = records.filter((item) => boundInput(ctx, item.value["verified_input_hash"], void 0).bound && (item.value["result"] === "passed" && item.carrier.value["status"] === "ok" || item.value["result"] === "failed" && item.carrier.value["status"] === "error"));
  const latest = (kind) => {
    const match = bound.filter((item) => item.value["kind"] === kind).sort((a, b) => b.carrier.line - a.carrier.line)[0];
    return match ? String(match.value["result"]) : "unknown";
  };
  const reopen = bound.length > 0 ? Math.max(...bound.map((item) => Number(item.value["reopen_transitions"]))) : null;
  const complete = bound.length > 0 && bound.every((item) => item.value["findings_complete"] === true);
  const residual = complete ? sortedUnique(bound.flatMap((item) => item.value["unresolved_finding_ids"])) : null;
  const state = bound.length > 0 ? "observed" : records.length > 0 ? "ambiguous" : "unobservable";
  return {
    result: result(
      "outcome_quality",
      state,
      {
        review: latest("review"),
        verify: latest("verify"),
        reopen_transitions: reopen,
        reopened: reopen === null ? null : reopen >= 1,
        residual_finding_ids: residual,
        residual_count: residual === null ? null : residual.length,
        unbound_records: records.length - bound.length
      },
      bound.flatMap((item) => [item.ref, item.carrier.ref]),
      state === "observed" ? null : state === "ambiguous" ? "unbound_verifier_input" : "no_typed_outcome_records"
    )
  };
}
function usageOutlierSingle(availability) {
  return {
    result: result("usage_outlier", "unobservable", {
      availability: Object.fromEntries(USAGE_METRICS.map((metric) => [metric, availability[metric].state]))
    }, [], "requires_comparison_cohort")
  };
}
function usageAvailability(events, groups, eligible) {
  const semanticSpans = new Set(events.filter(({ value }) => value["schema_version"] === "guild.trace.analysis.v2").map(({ value }) => scalar(value, "span_id")).filter((value) => value !== null));
  const counted = new Set(events.filter(({ value }) => {
    const span = scalar(value, "span_id");
    return value["schema_version"] === "guild.trace.analysis.v2" || !span || !semanticSpans.has(span);
  }).map((event) => event.ref));
  const explicit = (event, metric) => {
    const tokens = asRecord(event.value["tokens"]);
    const has = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (metric === "input") return has(tokens["input"]) || has(event.value["tokens_in"]);
    if (metric === "output") return has(tokens["output"]) || has(event.value["tokens_out"]);
    if (metric === "duration_ms") return has(event.value["duration_ms"]) || has(event.value["latency_ms"]);
    return has(tokens[metric]);
  };
  const tokenBoundary = (group) => groupHas(group, ["agent_response_received"]) || group.rows.some((row) => row.value["tokens"] !== void 0 || row.value["tokens_in"] !== void 0 || row.value["tokens_out"] !== void 0);
  const durationBoundary = (group) => groupHas(group, ["tool_call_finished", "tool_call_failed"]) || group.rows.some((row) => row.value["event"] === "tool_call" || row.value["event"] === "phase_end");
  return Object.fromEntries(USAGE_METRICS.map((metric) => {
    const refs = sortedUnique(events.filter((event) => counted.has(event.ref) && explicit(event, metric)).map((event) => event.ref));
    const boundaries = groups.filter(metric === "duration_ms" ? durationBoundary : tokenBoundary);
    const covered = boundaries.length > 0 && boundaries.every((group) => group.rows.some((row) => counted.has(row.ref) && explicit(row, metric)));
    const state = refs.length === 0 ? "unobserved" : eligible && covered ? "complete" : "partial";
    return [metric, { state, evidence_refs: refs, missing_reason: state === "complete" ? null : "incomplete_observation" }];
  }));
}
function knownIdentity(values) {
  const known = sortedUnique(values.filter((value) => value !== null && value !== "unknown"));
  return known.length === 1 && values.every((value) => value === null || value === known[0]) ? known[0] : null;
}
function analysisCohort(manifest, provenanceRaw, configSnapshot, events) {
  let provenance = {};
  try {
    provenance = asRecord(JSON.parse(provenanceRaw));
  } catch {
  }
  const inspections = events.filter(({ value }) => value["schema_version"] === "guild.trace.model_inspection.v1" && value["identity_trust"] === "verified").map(({ value }) => scalar(value, "actual_model"));
  const modelSources = [scalar(provenance, "model"), ...inspections].filter((value) => value !== null);
  return {
    run_class: scalar(manifest, "run_class"),
    model: modelSources.length > 0 ? knownIdentity(modelSources) : null,
    provider: knownIdentity([scalar(provenance, "provider")]),
    config_hash: configSnapshot ? `sha256:${sha2563(canonicalJson2({ effective: configSnapshot["effective"], plugin: configSnapshot["plugin"] }))}` : null
  };
}
function inputManifestHash(entries) {
  return `sha256:${sha2563(canonicalJson2(entries))}`;
}
function detectFindings(analysisId, events, groups) {
  const findings = [];
  const failures = /* @__PURE__ */ new Map();
  const steering = [];
  for (const group of groups) {
    if (group.rows.some(isFailureRow)) {
      const signature = failureSignature(group);
      if (signature !== null) failures.set(signature, [...failures.get(signature) ?? [], group]);
    }
    for (const row of rowsOf(group, ["instruction_violation_detected"]).slice(0, 1)) {
      findings.push(finding(analysisId, "instruction_violation", "high", "The trace records an instruction violation.", group.refs, scalar(row.value, "signature") ?? "instruction-violation"));
    }
    for (const row of rowsOf(group, ["loop_cap_hit"]).slice(0, 1)) {
      findings.push(finding(analysisId, "workflow_churn", "medium", "A workflow loop reached its cap.", group.refs, scalar(row.value, "signature") ?? "loop-cap"));
    }
    if (groupHas(group, ["user_steering_received"])) steering.push(group);
  }
  void events;
  for (const [signature, attempts] of [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (attempts.length >= REPEAT_THRESHOLD) {
      findings.push(finding(analysisId, "repeated_failure", "high", `The same failed action recurred ${attempts.length} times.`, attempts.flatMap((group) => group.refs), signature));
    }
  }
  if (steering.length >= REPEAT_THRESHOLD) {
    findings.push(finding(
      analysisId,
      "prompt_inefficiency",
      "medium",
      `The run required ${steering.length} user steering interventions.`,
      steering.flatMap((group) => group.refs),
      "repeated-user-steering"
    ));
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
function routingForScope(scope) {
  return scope === "plugin" ? { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" } : { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" };
}
function recommendationRoutingFields(scope) {
  const routing = routingForScope(scope);
  return {
    suggested_owner: scope === "plugin" ? "guild-plugin" : "project",
    next_action: routing.action,
    requires_user_approval: true,
    routing
  };
}
function recommendationsFor(analysisId, runId, findings, supported = []) {
  const v1 = findings.filter((item) => item.kind !== "tool_gap").map((item) => {
    const scope = item.kind === "telemetry_gap" ? "plugin" : "project";
    const kind = item.kind === "repeated_failure" ? "clarify_prompt_contract" : item.kind === "telemetry_gap" ? "telemetry_gap" : "update_workflow";
    return { scope, kind, severity: item.severity, summary: item.summary, evidence_refs: item.evidence_refs };
  });
  const seen = /* @__PURE__ */ new Set();
  return [...v1, ...supported].map((item) => {
    const refs = sortedUnique(item.evidence_refs);
    const signature = evidenceSignature(item.scope, item.kind, refs);
    return {
      schema_version: "guild.recommendation.v1",
      id: stableId("rec", signature),
      source_id: runId,
      source_analysis_id: analysisId,
      scope: item.scope,
      kind: item.kind,
      confidence: refs.length >= 2 ? "high" : "medium",
      severity: item.severity,
      evidence_refs: refs,
      evidence_signature: signature,
      affected_runs: [runId],
      proposed_action: item.summary,
      status: "proposed",
      ...recommendationRoutingFields(item.scope)
    };
  }).filter((item) => !seen.has(item.evidence_signature) && seen.add(item.evidence_signature) !== void 0).sort((a, b) => a.id.localeCompare(b.id));
}
function assessment(observableRefs, violatedRefs = []) {
  if (observableRefs.length === 0) return { status: "unobservable", evidence_refs: [] };
  if (violatedRefs.length > 0) return { status: "violated", evidence_refs: [.../* @__PURE__ */ new Set([...observableRefs, ...violatedRefs])].sort() };
  return { status: "ambiguous", evidence_refs: observableRefs.slice().sort() };
}
function collectRunInputs(root, runId) {
  const dir = runDir(root, runId);
  const runFile = resolveRunInputFile(dir, "run.yaml");
  const runRaw = runFile ? readText(runFile) : null;
  if (runRaw === null) throw new Error(`run ${runId} has no run.yaml`);
  const manifest = asRecord(parseYaml(runRaw));
  const { events, raw: eventsRaw, parseErrors, invalidRecords } = loadEvents(root, runId);
  const configRef = scalar(manifest, "config_snapshot_ref");
  const configPath = configRef ? resolveRunInputFile(dir, configRef) : null;
  const provenancePath = resolveRunInputFile(dir, "provenance.json");
  const provenanceRaw = provenancePath ? readText(provenancePath) ?? "" : "";
  const sourceHash = sha2563(runRaw + "\n" + provenanceRaw + "\n" + (configPath ? readText(configPath) ?? "" : "") + "\n" + eventsRaw);
  const store = /* @__PURE__ */ new Map();
  const sidecars = readSidecars(store, dir, runId, events);
  const declarations = sidecars.filter((item) => item.schema === "guild.analysis_declaration.v1");
  let declaration = null;
  let declarationReason = null;
  if (new Set(declarations.map((item) => canonicalJson2(item.value))).size > 1) declarationReason = "conflicting_instruction_declarations";
  else if (declarations.length > 0) {
    const assessed = readAdditiveInput(store, dir, runId, declarations[0].value["assessed_input_ref"]);
    if (assessed.bytes !== null && assessed.entry.sha256 === declarations[0].value["assessed_input_hash"]) declaration = declarations[0];
    else declarationReason = "assessed_input_unbound";
  }
  return {
    dir,
    manifest,
    provenanceRaw,
    configRef,
    configSnapshot: readConfigSnapshot(configPath, runId),
    events,
    parseErrors,
    invalidRecords,
    sourceHash,
    store,
    sidecars,
    declaration,
    declarationReason
  };
}
function manifestEntries(store) {
  return [...store.values()].map(({ entry }) => ({ ref: entry.ref, sha256: entry.sha256, status: entry.status })).sort((a, b) => a.ref.localeCompare(b.ref));
}
function analyzeRun(root, runId) {
  const inputs = collectRunInputs(root, runId);
  const { manifest, events, parseErrors, invalidRecords, sourceHash, configRef } = inputs;
  const scope = scalar(manifest, "run_scope");
  const initiativeId = scalar(manifest, "initiative_attachment");
  const independentGroup = scalar(manifest, "independent_run_group");
  const runScope = scope === "initiative" || scope === "independent" ? scope : initiativeId !== null ? "initiative" : "unknown";
  const configExists = inputs.configSnapshot !== null;
  const identityComplete = runScope !== "unknown" && (runScope === "initiative" ? initiativeId !== null : independentGroup !== null);
  const categories = new Set(events.map((event) => categoryOf(event.value)).filter((value) => value !== null));
  const missing = REQUIRED_COVERAGE.filter((category) => !categories.has(category));
  if (!identityComplete) missing.unshift("run identity");
  if (!configExists) missing.unshift("plugin-config-snapshot.json");
  if (parseErrors > 0) missing.push("trace parseability");
  if (invalidRecords > 0) missing.push("trace validity");
  const present = [
    ...identityComplete ? ["run identity"] : [],
    ...configExists ? ["plugin-config-snapshot.json"] : [],
    ...parseErrors === 0 ? ["trace parseability"] : [],
    ...invalidRecords === 0 ? ["trace validity"] : [],
    ...REQUIRED_COVERAGE.filter((category) => categories.has(category))
  ];
  const denominator = COMPLETENESS_REQUIREMENTS.length;
  const score = Math.round(present.length / denominator * 100);
  const analysisId = `analysis:${runId}:${sourceHash.slice(0, 12)}`;
  const groups = actionGroups(events, runId);
  const findings = detectFindings(analysisId, events, groups);
  if (missing.length > 0) {
    findings.push(finding(
      analysisId,
      "telemetry_gap",
      "medium",
      `Analysis evidence is incomplete: ${[...new Set(missing)].sort().join(", ")}.`,
      [`.guild/runs/${runId}/run.yaml`],
      `missing:${[...new Set(missing)].sort().join("|")}`
    ));
  }
  const instructionRefs = [...evidenceFor(events, "prompt"), ...evidenceFor(events, "gate")];
  const violationRefs = findings.filter((item) => item.kind === "instruction_violation").flatMap((item) => item.evidence_refs);
  const promptRefs = evidenceFor(events, "prompt");
  const workflowRefs = [...evidenceFor(events, "phase"), ...evidenceFor(events, "loop"), ...evidenceFor(events, "gate")];
  const toolRefs = evidenceFor(events, "tool");
  const isLightweight = manifest["run_class"] === "lightweight";
  const eligible = isLightweight || identityComplete && configExists && parseErrors === 0 && invalidRecords === 0 && REQUIRED_COVERAGE.every((category) => categories.has(category));
  const ctx = {
    runId,
    events,
    groups,
    sidecars: inputs.sidecars,
    declaration: inputs.declaration,
    declarationReason: inputs.declarationReason,
    store: inputs.store,
    dir: inputs.dir,
    eligible,
    closeRefs: events.filter((event) => categoryOf(event.value) === "close").map((event) => event.ref),
    instructionObservableRefs: instructionRefs,
    v1ViolationRefs: violationRefs
  };
  const usage2 = tokenUsage(events);
  const availability = usageAvailability(events, groups, eligible);
  const instruction = detectInstructionFollowing(ctx);
  const proofs = instructionProofs(ctx);
  const tools = detectToolCoverage(ctx);
  const outputs = [
    instruction,
    detectRepeatedMistake(ctx, proofs),
    detectSteering(ctx),
    detectClarification(ctx),
    detectRedundantPrompt(ctx),
    usageOutlierSingle(availability),
    detectPromptActionLatency(ctx),
    detectWorkflowChurn(ctx),
    detectKnowledgeMemory(ctx, proofs),
    tools,
    detectOutcomeQuality(ctx)
  ];
  const supported = [...tools.supported ?? [], ...tools.supportedOnly];
  const unownedFailures = groups.filter((group) => group.rows.some(isFailureRow)).length - new Set(supported.flatMap((item) => groups.filter((group) => group.rows.some(isFailureRow) && group.refs.some((ref) => item.evidence_refs.includes(ref))))).size;
  const scopeState = supported.length > 0 ? "observed" : unownedFailures > 0 ? "ambiguous" : "unobservable";
  outputs.push({
    result: result(
      "recommendation_scope",
      scopeState,
      {
        supported: supported.map((item) => ({ scope: item.scope, kind: item.kind, target: item.target })).sort((a, b) => `${a.scope}|${a.kind}|${a.target}`.localeCompare(`${b.scope}|${b.kind}|${b.target}`)),
        unowned_failed_actions: unownedFailures
      },
      supported.flatMap((item) => item.evidence_refs),
      scopeState === "observed" ? null : scopeState === "ambiguous" ? "unowned_action_failure" : "no_ownership_evidence"
    )
  });
  if (eligible) {
    for (const extra of outputs.flatMap((output) => output.findings ?? [])) {
      findings.push(finding(analysisId, extra.kind, extra.severity, extra.summary, extra.evidence_refs, extra.signature));
    }
  }
  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const inputManifest = manifestEntries(inputs.store);
  const instructionAssessment = !eligible ? { status: "unobservable", evidence_refs: [] } : instruction.aggregate === "satisfied" ? { status: "satisfied", evidence_refs: sortedUnique([...instructionRefs, ...instruction.satisfiedRefs]) } : assessment(instructionRefs, [...violationRefs, ...instruction.typedViolationRefs]);
  return {
    schema_version: "guild.run_analysis.v1",
    analysis_id: analysisId,
    run_id: runId,
    source_hash: sourceHash,
    eligible,
    identity: {
      run_scope: runScope,
      initiative_id: initiativeId,
      independent_group_id: independentGroup,
      config_snapshot_ref: configRef,
      host: scalar(asRecord(manifest["host"]), "resolved") ?? "unknown",
      phase: scalar(manifest, "phase")
    },
    completeness: { score, present: present.sort(), missing: [...new Set(missing)] },
    assessments: {
      instruction_following: instructionAssessment,
      prompt_efficiency: eligible ? assessment(promptRefs) : { status: "unobservable", evidence_refs: [] },
      workflow: eligible ? assessment(workflowRefs) : { status: "unobservable", evidence_refs: [] },
      tool_coverage: eligible ? assessment(toolRefs) : { status: "unobservable", evidence_refs: [] }
    },
    usage: { ...usage2, availability },
    findings: uniqueFindings,
    recommendations: recommendationsFor(analysisId, runId, uniqueFindings, eligible ? supported : []),
    diagnostics: {
      contract: DIAGNOSTICS_CONTRACT,
      input_manifest: inputManifest,
      input_hash: inputManifestHash(inputManifest),
      cohort: analysisCohort(manifest, inputs.provenanceRaw, inputs.configSnapshot, events),
      results: outputs.map((output) => output.result).sort((a, b) => a.detector.localeCompare(b.detector)),
      instruction_checks: instruction.checks
    }
  };
}
function cachedCoreWellFormed(cached) {
  const strings2 = (value) => arrayOf(value, (item) => typeof item === "string");
  const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const assessments = asRecord(cached["assessments"]);
  const completeness = asRecord(cached["completeness"]);
  const usage2 = asRecord(cached["usage"]);
  const tokens = asRecord(usage2["tokens"]);
  const availability = asRecord(usage2["availability"]);
  const identity = asRecord(cached["identity"]);
  const nullableString = (value) => value === null || nonEmptyString(value);
  return typeof cached["eligible"] === "boolean" && hasOnlyKeys(identity, /* @__PURE__ */ new Set(["run_scope", "initiative_id", "independent_group_id", "config_snapshot_ref", "host", "phase"])) && typeof identity["run_scope"] === "string" && ["initiative", "independent", "unknown"].includes(identity["run_scope"]) && nullableString(identity["initiative_id"]) && nullableString(identity["independent_group_id"]) && nullableString(identity["config_snapshot_ref"]) && nonEmptyString(identity["host"]) && nullableString(identity["phase"]) && arrayOf(cached["findings"], (item) => {
    const finding2 = item !== null && typeof item === "object" && !Array.isArray(item) ? item : null;
    return finding2 !== null && hasOnlyKeys(finding2, /* @__PURE__ */ new Set(["id", "kind", "severity", "summary", "evidence_refs", "signature"])) && nonEmptyString(finding2["id"]) && typeof finding2["kind"] === "string" && FINDING_KINDS.has(finding2["kind"]) && typeof finding2["severity"] === "string" && SEVERITY_VALUES.has(finding2["severity"]) && typeof finding2["summary"] === "string" && stringArray(finding2["evidence_refs"]) && nonEmptyString(finding2["signature"]);
  }) && hasOnlyKeys(assessments, /* @__PURE__ */ new Set(["instruction_following", "prompt_efficiency", "workflow", "tool_coverage"])) && ["instruction_following", "prompt_efficiency", "workflow", "tool_coverage"].every((key) => {
    const item = asRecord(assessments[key]);
    return typeof item["status"] === "string" && ["satisfied", "violated", "ambiguous", "unobservable"].includes(item["status"]) && strings2(item["evidence_refs"]);
  }) && typeof completeness["score"] === "number" && completeness["score"] >= 0 && completeness["score"] <= 100 && strings2(completeness["present"]) && strings2(completeness["missing"]) && count(usage2["llm_event_count"]) && strings2(usage2["specialists_dispatched"]) && count(usage2["duration_ms"]) && ["input", "output", "cached", "total", "cost_usd"].every((key) => count(tokens[key])) && USAGE_METRICS.every((metric) => {
    const item = asRecord(availability[metric]);
    return typeof item["state"] === "string" && ["complete", "partial", "unobserved"].includes(item["state"]) && strings2(item["evidence_refs"]);
  });
}
function loadOrAnalyzeRun(root, runId) {
  assertSafeId(runId, "run id");
  const inputs = collectRunInputs(root, runId);
  const currentInputHash = inputManifestHash(manifestEntries(inputs.store));
  const file = path15.join(durableGuildDir(root), "analysis", "runs", runId, "analysis.json");
  const raw = readExistingContainedText(root, file);
  const recompute = (reason) => ({ analysis: analyzeRun(root, runId), cache: "recomputed", reason });
  if (raw === null) return recompute("missing");
  let cached;
  try {
    cached = asRecord(JSON.parse(raw));
  } catch {
    return recompute("malformed");
  }
  if (cached["schema_version"] !== "guild.run_analysis.v1" || cached["run_id"] !== runId || typeof cached["source_hash"] !== "string" || cached["analysis_id"] !== `analysis:${runId}:${String(cached["source_hash"]).slice(0, 12)}` || !Array.isArray(cached["recommendations"])) return recompute("malformed");
  try {
    cached["recommendations"].forEach((item, index) => assertRecommendation(item, `cached recommendation ${index + 1}`));
  } catch {
    return recompute("malformed");
  }
  const diagnostics = asRecord(cached["diagnostics"]);
  if (diagnostics["contract"] !== DIAGNOSTICS_CONTRACT || !Array.isArray(diagnostics["input_manifest"]) || !Array.isArray(diagnostics["results"])) {
    return recompute(cached["diagnostics"] === void 0 ? "legacy_diagnostics" : "malformed");
  }
  if (!cachedCoreWellFormed(cached)) return recompute("malformed");
  if (diagnostics["input_hash"] !== inputManifestHash(diagnostics["input_manifest"])) return recompute("malformed");
  if (cached["source_hash"] !== inputs.sourceHash) return recompute("stale_source");
  if (diagnostics["input_hash"] !== currentInputHash) return recompute("stale_inputs");
  return { analysis: cached, cache: "hit", reason: null };
}
var INPUT_HASH_FORMAT = /^sha256:[a-f0-9]{64}$/;
var SOURCE_HASH_FORMAT = /^[a-f0-9]{64}$/;
var ANALYSIS_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
var InspectionRefusal = class extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
  reason;
};
function inspectionRefusal(reason) {
  throw new InspectionRefusal(reason);
}
function currentRunHashes(root, runId) {
  const runs = path15.join(durableGuildDir(path15.resolve(root)), "runs");
  try {
    fs12.lstatSync(path15.join(runs, runId));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    inspectionRefusal("unsafe_source_inputs");
  }
  let inputs;
  try {
    inputs = collectRunInputs(root, runId);
  } catch (error) {
    if (error instanceof Error && /has no run\.yaml/.test(error.message)) return null;
    inspectionRefusal("unsafe_source_inputs");
  }
  for (const proof of inputs.sidecars) {
    if (inputs.declaration && proof.schema === "guild.instruction_evidence.v1" && proof.value["verification_input_ref"] !== void 0 && proof.value["verified_input_hash"] === inputs.declaration.value["assessed_input_hash"]) {
      try {
        readAdditiveInput(inputs.store, inputs.dir, runId, proof.value["verification_input_ref"]);
      } catch {
        inspectionRefusal("unsafe_source_inputs");
      }
    }
  }
  return { sourceHash: inputs.sourceHash, inputHash: inputManifestHash(manifestEntries(inputs.store)) };
}
function readArtifactNoFollow(root, relative8) {
  let file;
  try {
    file = resolveRunInputFile(path15.resolve(root), relative8);
  } catch {
    inspectionRefusal("unsafe_artifact_path");
  }
  if (file === null) return null;
  try {
    return fs12.readFileSync(file, "utf8");
  } catch {
    inspectionRefusal("artifact_unreadable");
  }
}
var DETECTOR_STATES = /* @__PURE__ */ new Set(["observed", "ambiguous", "unobservable"]);
var plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function detectorResultsWellFormed(value, dimension) {
  const keys = /* @__PURE__ */ new Set(["detector", "state", "value", "evidence_refs", "reason", ...dimension ? ["by_run", "comparable_runs"] : []]);
  if (!Array.isArray(value) || value.length !== DETECTOR_IDS.length) return false;
  const seen = /* @__PURE__ */ new Set();
  return value.every((item) => {
    if (!plainObject(item) || !hasOnlyKeys(item, keys) || typeof item["detector"] !== "string" || !DETECTOR_IDS.includes(item["detector"]) || seen.has(item["detector"]) || typeof item["state"] !== "string" || !DETECTOR_STATES.has(item["state"]) || !plainObject(item["value"]) || !stringArray(item["evidence_refs"]) || !(item["reason"] === null || typeof item["reason"] === "string")) return false;
    seen.add(item["detector"]);
    if (!dimension) return true;
    const byRun = item["by_run"];
    return plainObject(byRun) && Object.keys(byRun).length === dimension.runIds.length && dimension.runIds.every((id) => {
      const entry = byRun[id];
      return plainObject(entry) && hasOnlyKeys(entry, /* @__PURE__ */ new Set(["state", "eligible", "value"])) && typeof entry["state"] === "string" && (DETECTOR_STATES.has(entry["state"]) || entry["state"] === "legacy_unknown") && typeof entry["eligible"] === "boolean" && plainObject(entry["value"]);
    }) && arrayOf(item["comparable_runs"], (id) => typeof id === "string" && dimension.runIds.includes(id));
  });
}
function inspectRunArtifact(root, runId, base, raw) {
  let cached;
  try {
    cached = asRecord(JSON.parse(raw));
  } catch {
    inspectionRefusal("malformed_artifact");
  }
  const schema = cached["schema_version"];
  if (schema !== "guild.run_analysis.v1") return { ...base, state: "unsupported", schema_version: typeof schema === "string" ? schema : null, reason: "unknown_core_schema" };
  const sourceHash = cached["source_hash"];
  if (cached["run_id"] !== runId || typeof sourceHash !== "string" || !SOURCE_HASH_FORMAT.test(sourceHash) || cached["analysis_id"] !== `analysis:${runId}:${sourceHash.slice(0, 12)}` || !Array.isArray(cached["recommendations"])) {
    inspectionRefusal("malformed_artifact");
  }
  try {
    cached["recommendations"].forEach((item, index) => assertRecommendation(item, `recommendation ${index + 1}`));
  } catch {
    inspectionRefusal("malformed_artifact");
  }
  const current = currentRunHashes(root, runId);
  const recorded = {
    ...base,
    schema_version: schema,
    source_analysis_id: cached["analysis_id"],
    source_hash: sourceHash,
    current_source_hash: current?.sourceHash ?? null,
    current_input_hash: current?.inputHash ?? null
  };
  const diagnostics = cached["diagnostics"];
  if (diagnostics === void 0) return { ...recorded, state: "unsupported", reason: "legacy_diagnostics_missing" };
  const contract = asRecord(diagnostics)["contract"];
  if (contract !== DIAGNOSTICS_CONTRACT) {
    const claimed = asRecord(diagnostics)["input_hash"];
    return { ...recorded, input_hash: typeof claimed === "string" && INPUT_HASH_FORMAT.test(claimed) ? claimed : null, state: "unsupported", reason: "unknown_diagnostics_contract" };
  }
  const record = asRecord(diagnostics);
  const manifest = record["input_manifest"];
  const inputHash = record["input_hash"];
  if (!Array.isArray(manifest) || !detectorResultsWellFormed(record["results"]) || typeof inputHash !== "string" || !INPUT_HASH_FORMAT.test(inputHash) || inputHash !== inputManifestHash(manifest) || !cachedCoreWellFormed(cached)) {
    inspectionRefusal("malformed_artifact");
  }
  const withInput = { ...recorded, input_hash: inputHash };
  if (current === null) return { ...withInput, state: "stale", reason: "source_inputs_missing" };
  if (current.sourceHash !== sourceHash) return { ...withInput, state: "stale", reason: "stale_source" };
  if (current.inputHash !== inputHash) return { ...withInput, state: "stale", reason: "stale_inputs" };
  return { ...withInput, state: "current", eligible: true, reason: null };
}
function comparisonRunsHash(runs) {
  return `sha256:${sha2563(canonicalJson2(runs.map(({ run_id, source_hash, input_hash }) => ({ run_id, source_hash, input_hash }))))}`;
}
function inspectComparisonArtifact(root, comparisonId, base, raw) {
  let cached;
  try {
    cached = asRecord(JSON.parse(raw));
  } catch {
    inspectionRefusal("malformed_artifact");
  }
  const schema = cached["schema_version"];
  if (schema !== "guild.run_comparison.v1") return { ...base, state: "unsupported", schema_version: typeof schema === "string" ? schema : null, reason: "unknown_core_schema" };
  const runIds = cached["run_ids"];
  const sourceHashes = cached["source_hashes"];
  if (cached["comparison_id"] !== comparisonId || !arrayOf(runIds, (id) => typeof id === "string" && SAFE_ID.test(id)) || !arrayOf(sourceHashes, (hash) => typeof hash === "string" && SOURCE_HASH_FORMAT.test(hash)) || runIds.length < 2 || runIds.length !== sourceHashes.length || runIds.some((id, index, all) => index > 0 && all[index - 1].localeCompare(id) >= 0) || !Array.isArray(cached["recommendations"])) {
    inspectionRefusal("malformed_artifact");
  }
  const ids = runIds;
  const hashes = sourceHashes;
  const material = ids.map((id, index) => `${id}:${hashes[index]}`).join("|");
  if (stableId("comparison", material) !== comparisonId) inspectionRefusal("malformed_artifact");
  try {
    cached["recommendations"].forEach((item, index) => assertRecommendation(item, `recommendation ${index + 1}`));
  } catch {
    inspectionRefusal("malformed_artifact");
  }
  const current = ids.map((id) => currentRunHashes(root, id));
  const currentMaterial = current.every((item) => item !== null) ? ids.map((id, index) => `${id}:${current[index].sourceHash}`).join("|") : null;
  const recorded = {
    ...base,
    schema_version: schema,
    source_analysis_id: comparisonId,
    source_hash: sha2563(material),
    current_source_hash: currentMaterial === null ? null : sha2563(currentMaterial),
    current_input_hash: currentMaterial === null ? null : comparisonRunsHash(ids.map((id, index) => ({ run_id: id, source_hash: current[index].sourceHash, input_hash: current[index].inputHash })))
  };
  const diagnostics = cached["diagnostics"];
  if (diagnostics === void 0) return { ...recorded, state: "unsupported", reason: "legacy_diagnostics_missing" };
  const record = asRecord(diagnostics);
  if (record["contract"] !== DIAGNOSTICS_CONTRACT) return { ...recorded, state: "unsupported", reason: "unknown_diagnostics_contract" };
  const retained = record["runs"];
  if (!Array.isArray(retained) || retained.length !== ids.length || !retained.every((value, index) => {
    if (!plainObject(value) || !hasOnlyKeys(value, /* @__PURE__ */ new Set(["run_id", "source_hash", "input_hash", "eligible"]))) return false;
    return value["run_id"] === ids[index] && value["source_hash"] === hashes[index] && typeof value["eligible"] === "boolean" && (value["input_hash"] === null || typeof value["input_hash"] === "string" && INPUT_HASH_FORMAT.test(value["input_hash"]));
  }) || !detectorResultsWellFormed(record["dimensions"], { runIds: ids })) inspectionRefusal("malformed_artifact");
  const retainedRuns = retained;
  const withInput = { ...recorded, input_hash: comparisonRunsHash(retainedRuns) };
  if (retainedRuns.some((item) => item.input_hash === null)) return { ...withInput, state: "unsupported", reason: "retained_run_legacy_diagnostics" };
  if (currentMaterial === null) return { ...withInput, state: "stale", reason: "retained_run_missing" };
  if (withInput.current_source_hash !== withInput.source_hash) return { ...withInput, state: "stale", reason: "stale_source" };
  if (withInput.current_input_hash !== withInput.input_hash) return { ...withInput, state: "stale", reason: "stale_inputs" };
  return { ...withInput, state: "current", eligible: true, reason: null };
}
function inspectAnalysisArtifact(root, kind, sourceId) {
  const base = {
    ok: true,
    state: "missing",
    kind,
    source_id: sourceId,
    artifact_ref: null,
    schema_version: null,
    source_analysis_id: null,
    source_hash: null,
    current_source_hash: null,
    input_hash: null,
    current_input_hash: null,
    eligible: false,
    reason: null
  };
  try {
    if (kind !== "run" && kind !== "comparison") inspectionRefusal("unknown_artifact_kind");
    try {
      assertRecommendationSourceId(sourceId, "source id");
    } catch {
      inspectionRefusal("unsafe_source_id");
    }
    const artifactRef = kind === "run" ? `.guild/analysis/runs/${sourceId}/analysis.json` : `.guild/analysis/comparisons/${sourceId}/comparison.json`;
    const located = { ...base, artifact_ref: artifactRef };
    const raw = readArtifactNoFollow(root, artifactRef);
    if (raw === null) {
      if (kind === "run") {
        const current = currentRunHashes(root, sourceId);
        return { ...located, current_source_hash: current?.sourceHash ?? null, current_input_hash: current?.inputHash ?? null, reason: "artifact_missing" };
      }
      return { ...located, reason: "artifact_missing" };
    }
    return kind === "run" ? inspectRunArtifact(root, sourceId, located, raw) : inspectComparisonArtifact(root, sourceId, located, raw);
  } catch (error) {
    if (!(error instanceof InspectionRefusal)) throw error;
    return { ...base, ok: false, state: "refused", eligible: false, reason: error.reason };
  }
}
function assertExpectedContextShape(expected) {
  if (expected === void 0) return;
  if (typeof expected.analysisId !== "string" || !ANALYSIS_ID_FORMAT.test(expected.analysisId)) {
    throw new Error("expected-analysis-id must be a producer-issued analysis identity");
  }
  if (typeof expected.inputHash !== "string" || !INPUT_HASH_FORMAT.test(expected.inputHash)) {
    throw new Error("expected-input-hash must be sha256:<64 lowercase hex>");
  }
}
function assertDecisionContext(root, sourceId, expected) {
  const runArtifact = path15.join(durableGuildDir(root), "analysis", "runs", sourceId, "analysis.json");
  const kind = fs12.existsSync(runArtifact) ? "run" : "comparison";
  const inspection = inspectAnalysisArtifact(root, kind, sourceId);
  if (expected !== void 0) {
    const changed = inspection.state !== "current" ? `${inspection.state}:${inspection.reason}` : inspection.source_analysis_id !== expected.analysisId ? "analysis_identity_changed" : inspection.input_hash !== expected.inputHash || inspection.current_input_hash !== expected.inputHash ? "input_hash_changed" : null;
    if (changed !== null) throw new Error(`expected_context_changed: ${changed}`);
    return;
  }
  if (inspection.state === "missing") return;
  if (inspection.state === "refused") throw new Error(`recommendation source refused: ${inspection.reason}`);
  if (inspection.state === "stale" || inspection.state === "unsupported" && inspection.source_hash !== null && inspection.current_source_hash !== inspection.source_hash) {
    throw new Error(`source_context_stale: ${inspection.reason === "legacy_diagnostics_missing" ? "stale_source" : inspection.reason}`);
  }
  if (inspection.state === "unsupported" && inspection.reason === "unknown_diagnostics_contract" && (inspection.input_hash === null || inspection.input_hash !== inspection.current_input_hash)) {
    throw new Error("source_context_stale: stale_inputs");
  }
}
function renderAnalysis(analysis) {
  const missing = analysis.completeness.missing.length > 0 ? analysis.completeness.missing.map((item) => `- ${item}`).join("\n") : "- none";
  const findings = analysis.findings.length > 0 ? analysis.findings.map((item) => `- **${item.kind}** \u2014 ${item.summary} (${item.evidence_refs.join(", ")})`).join("\n") : "- none";
  return `# Run analysis: ${analysis.run_id}

Schema: \`${analysis.schema_version}\`  
Eligible: **${analysis.eligible}**  
Evidence completeness: **${analysis.completeness.score}%**

## Missing evidence

${missing}

## Findings

${findings}
`;
}
function writeRunAnalysis(root, analysis) {
  return withRecommendationLock(root, () => {
    assertRecommendationSourceId(analysis.run_id, "run id");
    const outDir = path15.join(durableGuildDir(root), "analysis", "runs", analysis.run_id);
    const recommendationsDir = path15.join(durableGuildDir(root), "recommendations");
    const json = path15.join(outDir, "analysis.json");
    const markdown = path15.join(outDir, "analysis.md");
    const recommendations = path15.join(recommendationsDir, `${analysis.run_id}.jsonl`);
    assertGeneratedRecommendations(root, analysis.recommendations, {
      sourceId: analysis.run_id,
      sourceAnalysisId: analysis.analysis_id,
      runIds: [analysis.run_id]
    });
    const queue = path15.join(recommendationsDir, "queue.jsonl");
    const activity = path15.join(recommendationsDir, "activity.jsonl");
    return withFileTransaction(root, [json, markdown, recommendations, queue, activity], () => {
      const preserved = preserveRecordedStatuses(root, recommendations, analysis.recommendations, analysis.analysis_id);
      const recordedAnalysis = { ...analysis, recommendations: preserved.records };
      atomicWrite2(root, json, JSON.stringify(recordedAnalysis, null, 2) + "\n");
      atomicWrite2(root, markdown, renderAnalysis(recordedAnalysis));
      writeRecommendationRecords(root, recommendations, preserved.records);
      upsertProjectQueue(root, preserved.records);
      preserved.migrations.forEach(({ item, fromId, fromSourceId, fromSourceAnalysisId }) => recordRecommendationActivity(root, analysis.run_id, item, item.status, "status_migrated", fromId, fromSourceId, fromSourceAnalysisId, true));
      if (preserved.migrations.length > 0) readRecommendationActivity(root);
      return { json, markdown, recommendations };
    });
  });
}
function renderComparison(comparison) {
  const repeated = comparison.repeated_signatures.length > 0 ? comparison.repeated_signatures.map((item) => `- \`${item.signature}\` \u2014 ${item.occurrences} occurrence(s) across ${item.runs.join(", ")}`).join("\n") : "- none";
  return `# Run comparison: ${comparison.comparison_id}

Schema: \`${comparison.schema_version}\`  
Runs: **${comparison.run_ids.length}**  
Eligible: **${comparison.completeness.eligible_runs}/${comparison.completeness.total_runs}**  
Average evidence completeness: **${comparison.completeness.average_score}%**

## Runs

${comparison.run_ids.map((id) => `- ${id}`).join("\n")}

## Repeated signatures

${repeated}
`;
}
function writeRunComparison(root, comparison) {
  return withRecommendationLock(root, () => {
    assertRecommendationSourceId(comparison.comparison_id, "comparison id");
    const comparisonsDir = path15.join(durableGuildDir(root), "analysis", "comparisons");
    const outDir = path15.join(comparisonsDir, comparison.comparison_id);
    const recommendationsDir = path15.join(durableGuildDir(root), "recommendations");
    const json = path15.join(outDir, "comparison.json");
    const markdown = path15.join(outDir, "comparison.md");
    const recommendations = path15.join(recommendationsDir, `${comparison.comparison_id}.jsonl`);
    const index = path15.join(comparisonsDir, "index.json");
    assertGeneratedRecommendations(root, comparison.recommendations, {
      sourceId: comparison.comparison_id,
      sourceAnalysisId: comparison.comparison_id,
      runIds: comparison.run_ids
    });
    const queue = path15.join(recommendationsDir, "queue.jsonl");
    const activity = path15.join(recommendationsDir, "activity.jsonl");
    return withFileTransaction(root, [json, markdown, recommendations, queue, activity, index], () => {
      const preserved = preserveRecordedStatuses(root, recommendations, comparison.recommendations, comparison.comparison_id);
      const recordedComparison = { ...comparison, recommendations: preserved.records };
      atomicWrite2(root, json, JSON.stringify(recordedComparison, null, 2) + "\n");
      atomicWrite2(root, markdown, renderComparison(recordedComparison));
      writeRecommendationRecords(root, recommendations, preserved.records);
      upsertProjectQueue(root, preserved.records);
      preserved.migrations.forEach(({ item, fromId, fromSourceId, fromSourceAnalysisId }) => recordRecommendationActivity(root, comparison.comparison_id, item, item.status, "status_migrated", fromId, fromSourceId, fromSourceAnalysisId, true));
      if (preserved.migrations.length > 0) readRecommendationActivity(root);
      const old = readExistingContainedText(root, index);
      let entries = [];
      if (old) {
        try {
          const parsed = asRecord(JSON.parse(old));
          const values = parsed["comparisons"];
          if (Array.isArray(values)) {
            entries = values.filter((value) => {
              const item = asRecord(value);
              return typeof item["comparison_id"] === "string" && Array.isArray(item["run_ids"]) && Array.isArray(item["source_hashes"]);
            });
          }
        } catch {
        }
      }
      entries = entries.filter((item) => item.comparison_id !== comparison.comparison_id);
      entries.push({ comparison_id: comparison.comparison_id, run_ids: comparison.run_ids, source_hashes: comparison.source_hashes });
      entries.sort((a, b) => a.comparison_id.localeCompare(b.comparison_id));
      atomicWrite2(root, index, JSON.stringify({ schema_version: "guild.run_comparison_index.v1", comparisons: entries }, null, 2) + "\n");
      return { json, markdown, recommendations, index };
    });
  });
}
function discoverRunIds(root) {
  const runsDir = path15.join(durableGuildDir(root), "runs");
  try {
    return fs12.readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name)).map((entry) => entry.name).filter((id) => fs12.existsSync(path15.join(runsDir, id, "run.yaml"))).sort();
  } catch {
    return [];
  }
}
function resolveComparisonTarget(root, target) {
  if (target.kind !== "runs") assertSafeId(target.id, `${target.kind} id`);
  const discovered = target.kind === "runs" ? [...new Set(target.ids)].sort() : discoverRunIds(root);
  const ids = target.kind === "runs" ? discovered : discovered.filter((id) => {
    const dir = runDir(root, id);
    const manifest = resolveRunInputFile(dir, "run.yaml");
    const raw = manifest ? readText(manifest) : null;
    if (raw === null) return false;
    try {
      const manifest2 = asRecord(parseYaml(raw));
      if (target.kind === "initiative") return scalar(manifest2, "initiative_attachment") === target.id;
      const scope = scalar(manifest2, "run_scope");
      return scope === "independent" && scalar(manifest2, "independent_run_group") === target.id;
    } catch {
      return false;
    }
  });
  ids.forEach((id) => assertSafeId(id, "run id"));
  const analyses = ids.map((id) => analyzeRun(root, id));
  if (target.kind === "initiative") {
    return analyses.filter((analysis) => analysis.identity.initiative_id === target.id);
  }
  if (target.kind === "independent") {
    return analyses.filter((analysis) => analysis.identity.independent_group_id === target.id);
  }
  return analyses;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
var metricTotal = (analysis, metric) => metric === "duration_ms" ? analysis.usage.duration_ms : analysis.usage.tokens[metric];
function compareUsageOutlier(sorted) {
  const metrics = {};
  const refs = [];
  const comparable = /* @__PURE__ */ new Set();
  let observed = false;
  let zeroMedian = false;
  for (const metric of USAGE_METRICS) {
    let metricObserved = false;
    let metricZeroMedian = false;
    const complete = {};
    const partial = {};
    const unknown = [];
    const cohorts = /* @__PURE__ */ new Map();
    for (const analysis of sorted) {
      const availability = analysis.usage.availability?.[metric];
      if (!availability || availability.state === "unobserved") {
        unknown.push(analysis.run_id);
        continue;
      }
      if (availability.state === "partial") {
        partial[analysis.run_id] = metricTotal(analysis, metric);
        continue;
      }
      complete[analysis.run_id] = metricTotal(analysis, metric);
      const cohort = analysis.diagnostics?.cohort;
      if (!analysis.eligible || !cohort || Object.values(cohort).some((value) => value === null)) continue;
      const key = canonicalJson2(cohort);
      cohorts.set(key, [...cohorts.get(key) ?? [], analysis]);
    }
    const evaluated = [...cohorts.entries()].filter(([, runs]) => runs.length >= OUTLIER_MIN_COHORT).map(([key, runs]) => {
      const middle = median(runs.map((analysis) => metricTotal(analysis, metric)));
      if (middle <= 0) {
        zeroMedian = true;
        metricZeroMedian = true;
      }
      const outliers = middle > 0 ? runs.filter((analysis) => metricTotal(analysis, metric) > 2 * middle) : [];
      runs.forEach((analysis) => comparable.add(analysis.run_id));
      outliers.forEach((analysis) => refs.push(...analysis.usage.availability?.[metric].evidence_refs ?? []));
      if (middle > 0) {
        observed = true;
        metricObserved = true;
      }
      return { cohort: sha2563(key).slice(0, 16), runs: runs.map((analysis) => analysis.run_id), median: middle, outliers: middle > 0 ? outliers.map((analysis) => analysis.run_id) : null };
    }).sort((a, b) => a.cohort.localeCompare(b.cohort));
    metrics[metric] = {
      state: metricObserved ? "observed" : "unobservable",
      reason: metricObserved ? null : metricZeroMedian ? "zero_median" : "insufficient_comparable_cohort",
      complete_totals: complete,
      partial_subtotals: partial,
      unknown,
      cohorts: evaluated
    };
  }
  return {
    detector: "usage_outlier",
    state: observed ? "observed" : "unobservable",
    value: { min_cohort: OUTLIER_MIN_COHORT, metrics },
    evidence_refs: sortedUnique(refs),
    reason: observed ? null : zeroMedian ? "zero_median" : "insufficient_comparable_cohort",
    comparable: [...comparable].sort()
  };
}
function detectorValue(analysis, detector) {
  return analysis.diagnostics?.results.find((item) => item.detector === detector) ?? null;
}
function compareDiagnostics(sorted) {
  const eligible = sorted.filter((analysis) => analysis.eligible);
  const dimensions = DETECTOR_IDS.map((detector) => {
    const byRun = Object.fromEntries(sorted.map((analysis) => {
      const item = detectorValue(analysis, detector);
      return [analysis.run_id, { state: item?.state ?? "legacy_unknown", eligible: analysis.eligible, value: item?.value ?? {} }];
    }));
    const states = eligible.map((analysis) => byRun[analysis.run_id].state);
    const observedRuns = eligible.filter((analysis) => byRun[analysis.run_id].state === "observed").map((analysis) => analysis.run_id);
    const refs = eligible.flatMap((analysis) => detectorValue(analysis, detector)?.evidence_refs ?? []);
    let state = states.includes("observed") ? "observed" : states.includes("ambiguous") ? "ambiguous" : "unobservable";
    let reason = state === "unobservable" ? eligible.length === 0 ? "no_eligible_runs" : "no_observations" : null;
    let value = {};
    let comparable = observedRuns;
    if (detector === "usage_outlier") {
      const outlier = compareUsageOutlier(sorted);
      return { detector, state: outlier.state, value: outlier.value, evidence_refs: outlier.evidence_refs, reason: outlier.reason, by_run: byRun, comparable_runs: outlier.comparable };
    }
    if (detector === "instruction_following") {
      const scopes = Object.fromEntries(observedRuns.map((runId) => [runId, byRun[runId].value["requirement_hashes"] ?? []]));
      const distinct = new Set(Object.values(scopes).map((hashes) => hashes.join(",")));
      value = {
        by_aggregate: Object.fromEntries(["satisfied", "violated", "ambiguous", "unobservable"].map((status) => [
          status,
          eligible.filter((analysis) => byRun[analysis.run_id].value["aggregate"] === status).map((analysis) => analysis.run_id)
        ])),
        requirement_scopes: scopes
      };
      if (distinct.size > 1) {
        state = "ambiguous";
        reason = "incomparable_declared_scopes";
        comparable = [];
      }
    }
    if (detector === "repeated_mistake") {
      const clusters2 = /* @__PURE__ */ new Map();
      for (const analysis of eligible) {
        for (const cluster of byRun[analysis.run_id].value["clusters"] ?? []) {
          const current = clusters2.get(String(cluster["signature"])) ?? { runs: /* @__PURE__ */ new Set(), occurrences: 0, phases: /* @__PURE__ */ new Set() };
          current.runs.add(analysis.run_id);
          current.occurrences += Number(cluster["attempts"]);
          current.phases.add(String(cluster["phase"] ?? "-"));
          clusters2.set(String(cluster["signature"]), current);
        }
      }
      value = {
        cross_run_clusters: [...clusters2.entries()].filter(([, item]) => item.runs.size >= REPEAT_THRESHOLD).map(([signature, item]) => ({ signature, runs: [...item.runs].sort(), occurrences: item.occurrences, phases: [...item.phases].sort() })).sort((a, b) => a.signature.localeCompare(b.signature))
      };
    }
    return { detector, state, value, evidence_refs: sortedUnique(refs), reason, by_run: byRun, comparable_runs: comparable };
  });
  const clusters = /* @__PURE__ */ new Map();
  for (const analysis of eligible) {
    for (const item of detectorValue(analysis, "recommendation_scope")?.value["supported"] ?? []) {
      const key = `${item.scope}|${item.kind}|${item.target}`;
      const current = clusters.get(key) ?? { ...item, runs: /* @__PURE__ */ new Set() };
      current.runs.add(analysis.run_id);
      clusters.set(key, current);
    }
  }
  return {
    contract: DIAGNOSTICS_CONTRACT,
    runs: sorted.map((analysis) => ({ run_id: analysis.run_id, source_hash: analysis.source_hash, input_hash: analysis.diagnostics?.input_hash ?? null, eligible: analysis.eligible })),
    dimensions,
    recommendation_clusters: [...clusters.values()].filter((item) => item.runs.size >= REPEAT_THRESHOLD).map((item) => ({ scope: item.scope, kind: item.kind, target: item.target, runs: [...item.runs].sort() })).sort((a, b) => `${a.scope}|${a.kind}|${a.target}`.localeCompare(`${b.scope}|${b.kind}|${b.target}`))
  };
}
function compareRuns(analyses) {
  if (analyses.length < 2) throw new Error("comparison requires at least two run analyses");
  const sorted = [...analyses].sort((a, b) => a.run_id.localeCompare(b.run_id));
  const clusters = /* @__PURE__ */ new Map();
  for (const analysis of sorted.filter((item) => item.eligible)) {
    for (const item of analysis.findings) {
      const current = clusters.get(item.signature) ?? { runs: /* @__PURE__ */ new Set(), occurrences: 0, refs: /* @__PURE__ */ new Set(), severity: item.severity, kinds: /* @__PURE__ */ new Set() };
      current.runs.add(analysis.run_id);
      current.occurrences += 1;
      item.evidence_refs.forEach((ref) => current.refs.add(ref));
      current.kinds.add(item.kind);
      clusters.set(item.signature, current);
    }
  }
  const repeated = [...clusters.entries()].filter(([, value]) => value.runs.size >= 2 || value.occurrences >= 2).map(([signature, value]) => ({ signature, runs: [...value.runs].sort(), occurrences: value.occurrences })).sort((a, b) => a.signature.localeCompare(b.signature));
  const material = sorted.map((analysis) => `${analysis.run_id}:${analysis.source_hash}`).join("|");
  const comparisonId = stableId("comparison", material);
  const recommendations = repeated.map((cluster) => {
    const source = clusters.get(cluster.signature);
    const scope = source?.kinds.has("telemetry_gap") ? "plugin" : "project";
    const kind = scope === "plugin" ? "telemetry_gap" : "update_workflow";
    const refs = [...source?.refs ?? []].sort();
    const signature = evidenceSignature(scope, kind, refs);
    return {
      schema_version: "guild.recommendation.v1",
      id: stableId("rec", signature),
      source_id: comparisonId,
      source_analysis_id: comparisonId,
      scope,
      kind,
      confidence: "high",
      severity: "medium",
      evidence_refs: refs,
      evidence_signature: signature,
      affected_runs: cluster.runs,
      proposed_action: `Address repeated cross-run signature ${cluster.signature}`,
      status: "proposed",
      ...recommendationRoutingFields(scope)
    };
  });
  return {
    schema_version: "guild.run_comparison.v1",
    comparison_id: comparisonId,
    run_ids: sorted.map((analysis) => analysis.run_id),
    source_hashes: sorted.map((analysis) => analysis.source_hash),
    completeness: {
      eligible_runs: sorted.filter((analysis) => analysis.eligible).length,
      total_runs: sorted.length,
      average_score: Math.round(sorted.reduce((sum, analysis) => sum + analysis.completeness.score, 0) / sorted.length)
    },
    repeated_signatures: repeated,
    recommendations,
    diagnostics: compareDiagnostics(sorted)
  };
}
function decideRecommendationUnlocked(root, sourceId, recommendationId, decision) {
  if (decision !== "accept" && decision !== "reject") throw new Error("recommendation decision must be accept or reject");
  const source = recommendationSourceFile(root, sourceId);
  assertSafeId(recommendationId, "recommendation id");
  const current = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId)).find((item) => item.id === recommendationId);
  if (!current) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);
  if (decision === "reject") {
    if (!["proposed", "rejected"].includes(current.status)) {
      throw new Error(`cannot reject a recommendation with status ${current.status}`);
    }
    const updated2 = rewriteRecommendation(root, sourceId, recommendationId, "rejected", "recommendation_rejected");
    return { source_id: sourceId, recommendation_id: recommendationId, status: updated2.status, effect: "recommendation_rejected" };
  }
  if (current.scope === "project") {
    if (!["proposed", "queued"].includes(current.status)) throw new Error(`cannot queue a recommendation with status ${current.status}`);
    const updated2 = rewriteRecommendation(root, sourceId, recommendationId, "queued", "project_proposal_queued");
    return { source_id: sourceId, recommendation_id: recommendationId, status: updated2.status, effect: "project_proposal_queued" };
  }
  if (!["proposed", "accepted"].includes(current.status)) throw new Error(`cannot accept a recommendation with status ${current.status}`);
  const draft = path15.join(durableGuildDir(root), "recommendations", "drafts", `${recommendationId}.md`);
  assertOutputContained(root, draft);
  const updatedCandidate = { ...current, status: "accepted" };
  const body = `# Guild plugin recommendation draft: ${updatedCandidate.id}

Status: accepted locally; external filing has not occurred.

## Proposed action

${updatedCandidate.proposed_action}

## Evidence

${updatedCandidate.evidence_refs.map((ref) => `- \`${ref}\``).join("\n")}
`;
  const draftBefore = readExistingContainedText(root, draft);
  let updated;
  try {
    atomicWrite2(root, draft, body);
    updated = rewriteRecommendation(root, sourceId, recommendationId, "accepted", "plugin_draft_written");
  } catch (error) {
    restoreRecommendationFile(root, draft, draftBefore);
    throw error;
  }
  return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "plugin_draft_written", draft };
}
function decideRecommendation(root, sourceId, recommendationId, decision, expected) {
  assertSafeId(recommendationId, "recommendation id");
  assertRecommendationSourceId(sourceId, "recommendation source id");
  assertExpectedContextShape(expected);
  return withRecommendationLock(root, () => {
    assertDecisionContext(root, sourceId, expected);
    return withFileTransaction(root, [
      recommendationSourceFile(root, sourceId),
      path15.join(durableGuildDir(root), "recommendations", "queue.jsonl"),
      path15.join(durableGuildDir(root), "recommendations", "activity.jsonl"),
      path15.join(durableGuildDir(root), "recommendations", "drafts", `${recommendationId}.md`)
    ], () => decideRecommendationUnlocked(root, sourceId, recommendationId, decision));
  });
}
function updateRecommendationStatusUnlocked(root, sourceId, recommendationId, status) {
  if (!RECOMMENDATION_STATUSES.has(status)) throw new Error(`invalid recommendation status: ${String(status)}`);
  const source = recommendationSourceFile(root, sourceId);
  const current = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId)).find((item) => item.id === recommendationId);
  if (!current) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);
  if (current.status !== status) {
    const allowed = authorizedProgressTransition(current.scope, current.status, status);
    if (!allowed) throw new Error(`status transition ${current.status} -> ${status} is not authorized for ${current.scope} scope or lacks approval`);
  }
  const updated = rewriteRecommendation(root, sourceId, recommendationId, status, "status_recorded");
  return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "status_recorded" };
}
function updateRecommendationStatus(root, sourceId, recommendationId, status) {
  assertSafeId(recommendationId, "recommendation id");
  return withRecommendationLock(root, () => withFileTransaction(root, [
    recommendationSourceFile(root, sourceId),
    path15.join(durableGuildDir(root), "recommendations", "queue.jsonl"),
    path15.join(durableGuildDir(root), "recommendations", "activity.jsonl")
  ], () => updateRecommendationStatusUnlocked(root, sourceId, recommendationId, status)));
}

// scripts/run-analysis.ts
function usage(message) {
  if (message) process.stderr.write(`[run-analysis] ${message}
`);
  process.stderr.write(
    "usage:\n  run-analysis run analyze <run-id> [--cwd <root>]\n  run-analysis run compare <run-id> <run-id...> [--cwd <root>]\n  run-analysis initiative analyze <initiative-id> [--cwd <root>]\n  run-analysis independent-runs analyze <group-id> [--cwd <root>]\n  run-analysis artifact inspect <run|comparison> <source-id> [--cwd <root>]\n  run-analysis recommendation decide <source-id> <recommendation-id> <accept|reject>\n      [--expected-analysis-id <id> --expected-input-hash <sha256:hex>] [--cwd <root>]\n  run-analysis recommendation status <source-id> <recommendation-id> <status> [--cwd <root>]\n"
  );
  process.exit(2);
}
var VALUE_FLAGS = /* @__PURE__ */ new Set(["--cwd", "--expected-analysis-id", "--expected-input-hash"]);
function argumentsWithoutFlags(argv) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) usage(`unknown option: ${arg}`);
    if (flags.has(arg)) usage(`duplicate option: ${arg}`);
    const value = argv[i + 1];
    if (value === void 0 || value.length === 0 || value.startsWith("--")) usage(`${arg} requires a value`);
    flags.set(arg, value);
    i++;
  }
  const cwd = flags.has("--cwd") ? path16.resolve(flags.get("--cwd")) : process.cwd();
  return { cwd, positional, flags };
}
function expectedContext(flags) {
  const analysisId = flags.get("--expected-analysis-id");
  const inputHash = flags.get("--expected-input-hash");
  if (analysisId === void 0 && inputHash === void 0) return void 0;
  if (analysisId === void 0 || inputHash === void 0) {
    usage("--expected-analysis-id and --expected-input-hash must be passed together");
  }
  return { analysisId, inputHash };
}
function compareTarget(cwd, target) {
  const analyses = resolveComparisonTarget(cwd, target);
  if (analyses.length < 2) {
    throw new Error(`comparison target resolved ${analyses.length} run(s); at least two are required`);
  }
  analyses.forEach((analysis) => writeRunAnalysis(cwd, analysis));
  const comparison = compareRuns(analyses);
  const written = writeRunComparison(cwd, comparison);
  process.stdout.write(`${JSON.stringify({ ok: true, comparison_id: comparison.comparison_id, run_ids: comparison.run_ids, written }, null, 2)}
`);
}
function main(argv) {
  const { cwd, positional, flags } = argumentsWithoutFlags(argv);
  const [surface, action, ...ids] = positional;
  const isDecide = surface === "recommendation" && action === "decide";
  if (!isDecide && (flags.has("--expected-analysis-id") || flags.has("--expected-input-hash"))) {
    usage("--expected-* flags apply only to recommendation decide");
  }
  if (surface === "run" && action === "analyze" && ids.length === 1) {
    const cached = loadOrAnalyzeRun(cwd, ids[0]);
    const written = cached.cache === "hit" ? null : writeRunAnalysis(cwd, cached.analysis);
    process.stdout.write(`${JSON.stringify({ ok: true, analysis_id: cached.analysis.analysis_id, eligible: cached.analysis.eligible, cache: cached.cache, reason: cached.reason, written }, null, 2)}
`);
    return;
  }
  if (surface === "artifact" && action === "inspect" && ids.length === 2 && (ids[0] === "run" || ids[0] === "comparison")) {
    const inspection = inspectAnalysisArtifact(cwd, ids[0], ids[1]);
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}
`);
    if (inspection.state === "refused") process.exitCode = 1;
    return;
  }
  if (surface === "run" && action === "compare" && ids.length >= 2) {
    compareTarget(cwd, { kind: "runs", ids });
    return;
  }
  if (surface === "initiative" && action === "analyze" && ids.length === 1) {
    compareTarget(cwd, { kind: "initiative", id: ids[0] });
    return;
  }
  if (surface === "independent-runs" && action === "analyze" && ids.length === 1) {
    compareTarget(cwd, { kind: "independent", id: ids[0] });
    return;
  }
  if (isDecide && ids.length === 3 && (ids[2] === "accept" || ids[2] === "reject")) {
    const expected = expectedContext(flags);
    process.stdout.write(`${JSON.stringify({ ok: true, ...decideRecommendation(cwd, ids[0], ids[1], ids[2], expected) }, null, 2)}
`);
    return;
  }
  const statuses = /* @__PURE__ */ new Set(["filed", "implemented", "superseded"]);
  if (surface === "recommendation" && action === "status" && ids.length === 3 && statuses.has(ids[2])) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...updateRecommendationStatus(cwd, ids[0], ids[1], ids[2]) }, null, 2)}
`);
    return;
  }
  usage("invalid command");
}
try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[run-analysis] ${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
