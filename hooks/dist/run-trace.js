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

// ../scripts/node_modules/js-yaml/lib/js-yaml/common.js
var require_common = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/common.js"(exports2, module2) {
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
      var index, length, key, sourceKeys;
      if (source) {
        sourceKeys = Object.keys(source);
        for (index = 0, length = sourceKeys.length; index < length; index += 1) {
          key = sourceKeys[index];
          target[key] = source[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      var result = "", cycle;
      for (cycle = 0; cycle < count; cycle += 1) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/exception.js
var require_exception = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/exception.js"(exports2, module2) {
    "use strict";
    function YAMLException(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = (this.reason || "(unknown reason)") + (this.mark ? " " + this.mark.toString() : "");
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error().stack || "";
      }
    }
    YAMLException.prototype = Object.create(Error.prototype);
    YAMLException.prototype.constructor = YAMLException;
    YAMLException.prototype.toString = function toString(compact) {
      var result = this.name + ": ";
      result += this.reason || "(unknown reason)";
      if (!compact && this.mark) {
        result += " " + this.mark.toString();
      }
      return result;
    };
    module2.exports = YAMLException;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/mark.js
var require_mark = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/mark.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    function Mark(name, buffer, position, line, column) {
      this.name = name;
      this.buffer = buffer;
      this.position = position;
      this.line = line;
      this.column = column;
    }
    Mark.prototype.getSnippet = function getSnippet(indent, maxLength) {
      var head, start, tail, end, snippet;
      if (!this.buffer) return null;
      indent = indent || 4;
      maxLength = maxLength || 75;
      head = "";
      start = this.position;
      while (start > 0 && "\0\r\n\x85\u2028\u2029".indexOf(this.buffer.charAt(start - 1)) === -1) {
        start -= 1;
        if (this.position - start > maxLength / 2 - 1) {
          head = " ... ";
          start += 5;
          break;
        }
      }
      tail = "";
      end = this.position;
      while (end < this.buffer.length && "\0\r\n\x85\u2028\u2029".indexOf(this.buffer.charAt(end)) === -1) {
        end += 1;
        if (end - this.position > maxLength / 2 - 1) {
          tail = " ... ";
          end -= 5;
          break;
        }
      }
      snippet = this.buffer.slice(start, end);
      return common.repeat(" ", indent) + head + snippet + tail + "\n" + common.repeat(" ", indent + this.position - start + head.length) + "^";
    };
    Mark.prototype.toString = function toString(compact) {
      var snippet, where = "";
      if (this.name) {
        where += 'in "' + this.name + '" ';
      }
      where += "at line " + (this.line + 1) + ", column " + (this.column + 1);
      if (!compact) {
        snippet = this.getSnippet();
        if (snippet) {
          where += ":\n" + snippet;
        }
      }
      return where;
    };
    module2.exports = Mark;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type.js
var require_type = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "defaultStyle",
      "styleAliases"
    ];
    var YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map) {
      var result = {};
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
      this.defaultStyle = options["defaultStyle"] || null;
      this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
        throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
    }
    module2.exports = Type;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema.js
var require_schema = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var Type = require_type();
    function compileList(schema, name, result) {
      var exclude = [];
      schema.include.forEach(function(includedSchema) {
        result = compileList(includedSchema, name, result);
      });
      schema[name].forEach(function(currentType) {
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind) {
            exclude.push(previousIndex);
          }
        });
        result.push(currentType);
      });
      return result.filter(function(type, index) {
        return exclude.indexOf(index) === -1;
      });
    }
    function compileMap() {
      var result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {}
      }, index, length;
      function collectType(type) {
        result[type.kind][type.tag] = result["fallback"][type.tag] = type;
      }
      for (index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result;
    }
    function Schema(definition) {
      this.include = definition.include || [];
      this.implicit = definition.implicit || [];
      this.explicit = definition.explicit || [];
      this.implicit.forEach(function(type) {
        if (type.loadKind && type.loadKind !== "scalar") {
          throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
      });
      this.compiledImplicit = compileList(this, "implicit", []);
      this.compiledExplicit = compileList(this, "explicit", []);
      this.compiledTypeMap = compileMap(this.compiledImplicit, this.compiledExplicit);
    }
    Schema.DEFAULT = null;
    Schema.create = function createSchema() {
      var schemas, types;
      switch (arguments.length) {
        case 1:
          schemas = Schema.DEFAULT;
          types = arguments[0];
          break;
        case 2:
          schemas = arguments[0];
          types = arguments[1];
          break;
        default:
          throw new YAMLException("Wrong number of arguments for Schema.create function");
      }
      schemas = common.toArray(schemas);
      types = common.toArray(types);
      if (!schemas.every(function(schema) {
        return schema instanceof Schema;
      })) {
        throw new YAMLException("Specified list of super schemas (or a single Schema object) contains a non-Schema object.");
      }
      if (!types.every(function(type) {
        return type instanceof Type;
      })) {
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      return new Schema({
        include: schemas,
        explicit: types
      });
    };
    module2.exports = Schema;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/str.js
var require_str = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/str.js"(exports2, module2) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/seq.js
var require_seq = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/seq.js"(exports2, module2) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/map.js
var require_map = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/map.js"(exports2, module2) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema/failsafe.js
var require_failsafe = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema/failsafe.js"(exports2, module2) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/null.js
var require_null = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/null.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlNull(data) {
      if (data === null) return true;
      var max = data.length;
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
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/bool.js
var require_bool = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/bool.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      var max = data.length;
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/int.js
var require_int = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/int.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    function isHexCode(c) {
      return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
    }
    function isOctCode(c) {
      return 48 <= c && c <= 55;
    }
    function isDecCode(c) {
      return 48 <= c && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      var max = data.length, index = 0, hasDigits = false, ch;
      if (!max) return false;
      ch = data[index];
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
            if (ch === "_") continue;
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && ch !== "_";
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch === "_") continue;
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && ch !== "_";
        }
        for (; index < max; index++) {
          ch = data[index];
          if (ch === "_") continue;
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && ch !== "_";
      }
      if (ch === "_") return false;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch === ":") break;
        if (!isDecCode(data.charCodeAt(index))) {
          return false;
        }
        hasDigits = true;
      }
      if (!hasDigits || ch === "_") return false;
      if (ch !== ":") return true;
      return /^(:[0-5]?[0-9])+$/.test(data.slice(index));
    }
    function constructYamlInteger(data) {
      var value = data, sign = 1, ch, base, digits = [];
      if (value.indexOf("_") !== -1) {
        value = value.replace(/_/g, "");
      }
      ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value, 16);
        return sign * parseInt(value, 8);
      }
      if (value.indexOf(":") !== -1) {
        value.split(":").forEach(function(v) {
          digits.unshift(parseInt(v, 10));
        });
        value = 0;
        base = 1;
        digits.forEach(function(d) {
          value += d * base;
          base *= 60;
        });
        return sign * value;
      }
      return sign * parseInt(value, 10);
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
          return obj >= 0 ? "0" + obj.toString(8) : "-0" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        /* eslint-disable max-len */
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/float.js
var require_float = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/float.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    var YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:0|[1-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
      // Probably should update regexp & check speed
      data[data.length - 1] === "_") {
        return false;
      }
      return true;
    }
    function constructYamlFloat(data) {
      var value, sign, base, digits;
      value = data.replace(/_/g, "").toLowerCase();
      sign = value[0] === "-" ? -1 : 1;
      digits = [];
      if ("+-".indexOf(value[0]) >= 0) {
        value = value.slice(1);
      }
      if (value === ".inf") {
        return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      } else if (value === ".nan") {
        return NaN;
      } else if (value.indexOf(":") >= 0) {
        value.split(":").forEach(function(v) {
          digits.unshift(parseFloat(v, 10));
        });
        value = 0;
        base = 1;
        digits.forEach(function(d) {
          value += d * base;
          base *= 60;
        });
        return sign * value;
      }
      return sign * parseFloat(value, 10);
    }
    var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      var res;
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
      res = object.toString(10);
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema/json.js
var require_json = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema/json.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_failsafe()
      ],
      implicit: [
        require_null(),
        require_bool(),
        require_int(),
        require_float()
      ]
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema/core.js
var require_core = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema/core.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_json()
      ]
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/timestamp.js
var require_timestamp = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/timestamp.js"(exports2, module2) {
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
      var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
      match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      year = +match[1];
      month = +match[2] - 1;
      day = +match[3];
      if (!match[4]) {
        return new Date(Date.UTC(year, month, day));
      }
      hour = +match[4];
      minute = +match[5];
      second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) {
          fraction += "0";
        }
        fraction = +fraction;
      }
      if (match[9]) {
        tz_hour = +match[10];
        tz_minute = +(match[11] || 0);
        delta = (tz_hour * 60 + tz_minute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/merge.js
var require_merge = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/merge.js"(exports2, module2) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/binary.js
var require_binary = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/binary.js"(exports2, module2) {
    "use strict";
    var NodeBuffer;
    try {
      _require = require;
      NodeBuffer = _require("buffer").Buffer;
    } catch (__) {
    }
    var _require;
    var Type = require_type();
    var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      var code, idx, bitlen = 0, max = data.length, map = BASE64_MAP;
      for (idx = 0; idx < max; idx++) {
        code = map.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map = BASE64_MAP, bits = 0, result = [];
      for (idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      tailbits = max % 4 * 6;
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
      if (NodeBuffer) {
        return NodeBuffer.from ? NodeBuffer.from(result) : new NodeBuffer(result);
      }
      return result;
    }
    function representYamlBinary(object) {
      var result = "", bits = 0, idx, tail, max = object.length, map = BASE64_MAP;
      for (idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      tail = max % 3;
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
    function isBinary(object) {
      return NodeBuffer && NodeBuffer.isBuffer(object);
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/omap.js
var require_omap = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/omap.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/pairs.js
var require_pairs = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/pairs.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      var index, length, pair, keys, result, object = data;
      result = new Array(object.length);
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      var index, length, pair, keys, result, object = data;
      result = new Array(object.length);
      for (index = 0, length = object.length; index < length; index += 1) {
        pair = object[index];
        keys = Object.keys(pair);
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/set.js
var require_set = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/set.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      var key, object = data;
      for (key in object) {
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema/default_safe.js
var require_default_safe = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema/default_safe.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      include: [
        require_core()
      ],
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

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/js/undefined.js
var require_undefined = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/js/undefined.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveJavascriptUndefined() {
      return true;
    }
    function constructJavascriptUndefined() {
      return void 0;
    }
    function representJavascriptUndefined() {
      return "";
    }
    function isUndefined(object) {
      return typeof object === "undefined";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/undefined", {
      kind: "scalar",
      resolve: resolveJavascriptUndefined,
      construct: constructJavascriptUndefined,
      predicate: isUndefined,
      represent: representJavascriptUndefined
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/js/regexp.js
var require_regexp = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/js/regexp.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveJavascriptRegExp(data) {
      if (data === null) return false;
      if (data.length === 0) return false;
      var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
      if (regexp[0] === "/") {
        if (tail) modifiers = tail[1];
        if (modifiers.length > 3) return false;
        if (regexp[regexp.length - modifiers.length - 1] !== "/") return false;
      }
      return true;
    }
    function constructJavascriptRegExp(data) {
      var regexp = data, tail = /\/([gim]*)$/.exec(data), modifiers = "";
      if (regexp[0] === "/") {
        if (tail) modifiers = tail[1];
        regexp = regexp.slice(1, regexp.length - modifiers.length - 1);
      }
      return new RegExp(regexp, modifiers);
    }
    function representJavascriptRegExp(object) {
      var result = "/" + object.source + "/";
      if (object.global) result += "g";
      if (object.multiline) result += "m";
      if (object.ignoreCase) result += "i";
      return result;
    }
    function isRegExp(object) {
      return Object.prototype.toString.call(object) === "[object RegExp]";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/regexp", {
      kind: "scalar",
      resolve: resolveJavascriptRegExp,
      construct: constructJavascriptRegExp,
      predicate: isRegExp,
      represent: representJavascriptRegExp
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/type/js/function.js
var require_function = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/type/js/function.js"(exports2, module2) {
    "use strict";
    var esprima;
    try {
      _require = require;
      esprima = _require("esprima");
    } catch (_) {
      if (typeof window !== "undefined") esprima = window.esprima;
    }
    var _require;
    var Type = require_type();
    function resolveJavascriptFunction(data) {
      if (data === null) return false;
      try {
        var source = "(" + data + ")", ast = esprima.parse(source, { range: true });
        if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") {
          return false;
        }
        return true;
      } catch (err) {
        return false;
      }
    }
    function constructJavascriptFunction(data) {
      var source = "(" + data + ")", ast = esprima.parse(source, { range: true }), params = [], body;
      if (ast.type !== "Program" || ast.body.length !== 1 || ast.body[0].type !== "ExpressionStatement" || ast.body[0].expression.type !== "ArrowFunctionExpression" && ast.body[0].expression.type !== "FunctionExpression") {
        throw new Error("Failed to resolve function");
      }
      ast.body[0].expression.params.forEach(function(param) {
        params.push(param.name);
      });
      body = ast.body[0].expression.body.range;
      if (ast.body[0].expression.body.type === "BlockStatement") {
        return new Function(params, source.slice(body[0] + 1, body[1] - 1));
      }
      return new Function(params, "return " + source.slice(body[0], body[1]));
    }
    function representJavascriptFunction(object) {
      return object.toString();
    }
    function isFunction(object) {
      return Object.prototype.toString.call(object) === "[object Function]";
    }
    module2.exports = new Type("tag:yaml.org,2002:js/function", {
      kind: "scalar",
      resolve: resolveJavascriptFunction,
      construct: constructJavascriptFunction,
      predicate: isFunction,
      represent: representJavascriptFunction
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/schema/default_full.js
var require_default_full = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/schema/default_full.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = Schema.DEFAULT = new Schema({
      include: [
        require_default_safe()
      ],
      explicit: [
        require_undefined(),
        require_regexp(),
        require_function()
      ]
    });
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/loader.js
var require_loader = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/loader.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var Mark = require_mark();
    var DEFAULT_SAFE_SCHEMA = require_default_safe();
    var DEFAULT_FULL_SCHEMA = require_default_full();
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
    var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
    var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
    var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function is_EOL(c) {
      return c === 10 || c === 13;
    }
    function is_WHITE_SPACE(c) {
      return c === 9 || c === 32;
    }
    function is_WS_OR_EOL(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function is_FLOW_INDICATOR(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      var lc;
      if (48 <= c && c <= 57) {
        return c - 48;
      }
      lc = c | 32;
      if (97 <= lc && lc <= 102) {
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
      if (48 <= c && c <= 57) {
        return c - 48;
      }
      return -1;
    }
    function simpleEscapeSequence(c) {
      return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
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
    for (i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    var i;
    function State(input, options) {
      this.input = input;
      this.filename = options["filename"] || null;
      this.schema = options["schema"] || DEFAULT_FULL_SCHEMA;
      this.onWarning = options["onWarning"] || null;
      this.legacy = options["legacy"] || false;
      this.json = options["json"] || false;
      this.listener = options["listener"] || null;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.documents = [];
    }
    function generateError(state, message) {
      return new YAMLException(
        message,
        new Mark(state.filename, state.input, state.position, state.line, state.position - state.lineStart)
      );
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) {
        state.onWarning.call(null, generateError(state, message));
      }
    }
    var directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        var match, major, minor;
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        major = parseInt(match[1], 10);
        minor = parseInt(match[2], 10);
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
        var handle, prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        handle = args[0];
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
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      var _position, _length, _character, _result;
      if (start < end) {
        _result = state.input.slice(start, end);
        if (checkJson) {
          for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
            _character = _result.charCodeAt(_position);
            if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
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
      var sourceKeys, key, index, quantity;
      if (!common.isObject(source)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      sourceKeys = Object.keys(source);
      for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        key = sourceKeys[index];
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startPos) {
      var index, quantity;
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
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
          for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            mergeMappings(state, _result, valueNode[index], overridableKeys);
          }
        } else {
          mergeMappings(state, _result, valueNode, overridableKeys);
        }
      } else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      var ch;
      ch = state.input.charCodeAt(state.position);
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
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 10 && ch !== 13 && ch !== 0);
        }
        if (is_EOL(ch)) {
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
      var _position = state.position, ch;
      ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || is_WS_OR_EOL(ch)) {
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
      var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
      ch = state.input.charCodeAt(state.position);
      if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
        return false;
      }
      if (ch === 63 || ch === 45) {
        following = state.input.charCodeAt(state.position + 1);
        if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
          return false;
        }
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          following = state.input.charCodeAt(state.position + 1);
          if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
            break;
          }
        } else if (ch === 35) {
          preceding = state.input.charCodeAt(state.position - 1);
          if (is_WS_OR_EOL(preceding)) {
            break;
          }
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
          break;
        } else if (is_EOL(ch)) {
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
        if (!is_WHITE_SPACE(ch)) {
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
      var ch, captureStart, captureEnd;
      ch = state.input.charCodeAt(state.position);
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
        } else if (is_EOL(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a single quoted scalar");
        } else {
          state.position++;
          captureEnd = state.position;
        }
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
      ch = state.input.charCodeAt(state.position);
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
          if (is_EOL(ch)) {
            skipSeparationSpace(state, false, nodeIndent);
          } else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            hexLength = tmp;
            hexResult = 0;
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
        } else if (is_EOL(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a double quoted scalar");
        } else {
          state.position++;
          captureEnd = state.position;
        }
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      var readNext = true, _line, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = {}, keyNode, keyTag, valueNode, ch;
      ch = state.input.charCodeAt(state.position);
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
        state.anchorMap[state.anchor] = _result;
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
        }
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          following = state.input.charCodeAt(state.position + 1);
          if (is_WS_OR_EOL(following)) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
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
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode);
        } else if (isPair) {
          _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode));
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
      var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
      ch = state.input.charCodeAt(state.position);
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
      if (is_WHITE_SPACE(ch)) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (is_WHITE_SPACE(ch));
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (!is_EOL(ch) && ch !== 0);
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
        if (is_EOL(ch)) {
          emptyLines++;
          continue;
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
          if (is_WHITE_SPACE(ch)) {
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
        captureStart = state.position;
        while (!is_EOL(ch) && ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = _result;
      }
      ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (ch !== 45) {
          break;
        }
        following = state.input.charCodeAt(state.position + 1);
        if (!is_WS_OR_EOL(following)) {
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
        _line = state.line;
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
      var following, allowCompact, _line, _pos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = {}, keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = _result;
      }
      ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        following = state.input.charCodeAt(state.position + 1);
        _line = state.line;
        _pos = state.position;
        if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
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
        } else if (composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (is_WHITE_SPACE(ch)) {
              ch = state.input.charCodeAt(++state.position);
            }
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!is_WS_OR_EOL(ch)) {
                throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              }
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
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
        } else {
          break;
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
            if (atExplicitKey) {
              keyNode = state.result;
            } else {
              valueNode = state.result;
            }
          }
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _pos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if (state.lineIndent > nodeIndent && ch !== 0) {
          throwError(state, "bad indentation of a mapping entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null);
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
      var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
      ch = state.input.charCodeAt(state.position);
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
      _position = state.position;
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
        while (ch !== 0 && !is_WS_OR_EOL(ch)) {
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
      var _position, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) {
        throwError(state, "duplication of an anchor property");
      }
      ch = state.input.charCodeAt(++state.position);
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an anchor node must contain at least one character");
      }
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      var _position, alias, ch;
      ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an alias node must contain at least one character");
      }
      alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) {
        throwError(state, 'unidentified alias "' + alias + '"');
      }
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, type, flowIndent, blockIndent;
      if (state.listener !== null) {
        state.listener("open", state);
      }
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
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
        while (readTagProperty(state) || readAnchorProperty(state)) {
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
            if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
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
              state.anchorMap[state.anchor] = state.result;
            }
          }
        } else if (indentStatus === 0) {
          hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
      }
      if (state.tag !== null && state.tag !== "!") {
        if (state.tag === "?") {
          if (state.result !== null && state.kind !== "scalar") {
            throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
          }
          for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
            type = state.implicitTypes[typeIndex];
            if (type.resolve(state.result)) {
              state.result = type.construct(state.result);
              state.tag = type.tag;
              if (state.anchor !== null) {
                state.anchorMap[state.anchor] = state.result;
              }
              break;
            }
          }
        } else if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
          type = state.typeMap[state.kind || "fallback"][state.tag];
          if (state.result !== null && type.kind !== state.kind) {
            throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
          }
          if (!type.resolve(state.result)) {
            throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
          } else {
            state.result = type.construct(state.result);
            if (state.anchor !== null) {
              state.anchorMap[state.anchor] = state.result;
            }
          }
        } else {
          throwError(state, "unknown tag !<" + state.tag + ">");
        }
      }
      if (state.listener !== null) {
        state.listener("close", state);
      }
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = {};
      state.anchorMap = {};
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) {
          break;
        }
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        _position = state.position;
        while (ch !== 0 && !is_WS_OR_EOL(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveName = state.input.slice(_position, state.position);
        directiveArgs = [];
        if (directiveName.length < 1) {
          throwError(state, "directive name must not be less than one character in length");
        }
        while (ch !== 0) {
          while (is_WHITE_SPACE(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 35) {
            do {
              ch = state.input.charCodeAt(++state.position);
            } while (ch !== 0 && !is_EOL(ch));
            break;
          }
          if (is_EOL(ch)) break;
          _position = state.position;
          while (ch !== 0 && !is_WS_OR_EOL(ch)) {
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
      } else {
        return;
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
      var state = new State(input, options);
      var nullpos = input.indexOf("\0");
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
      var documents = loadDocuments(input, options);
      if (typeof iterator !== "function") {
        return documents;
      }
      for (var index = 0, length = documents.length; index < length; index += 1) {
        iterator(documents[index]);
      }
    }
    function load2(input, options) {
      var documents = loadDocuments(input, options);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException("expected a single document in the stream, but found more");
    }
    function safeLoadAll(input, iterator, options) {
      if (typeof iterator === "object" && iterator !== null && typeof options === "undefined") {
        options = iterator;
        iterator = null;
      }
      return loadAll(input, iterator, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
    }
    function safeLoad(input, options) {
      return load2(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
    }
    module2.exports.loadAll = loadAll;
    module2.exports.load = load2;
    module2.exports.safeLoadAll = safeLoadAll;
    module2.exports.safeLoad = safeLoad;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml/dumper.js
var require_dumper = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml/dumper.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var DEFAULT_FULL_SCHEMA = require_default_full();
    var DEFAULT_SAFE_SCHEMA = require_default_safe();
    var _toString = Object.prototype.toString;
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
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
    function compileStyleMap(schema, map) {
      var result, keys, index, length, tag, style, type;
      if (map === null) return {};
      result = {};
      keys = Object.keys(map);
      for (index = 0, length = keys.length; index < length; index += 1) {
        tag = keys[index];
        style = String(map[tag]);
        if (tag.slice(0, 2) === "!!") {
          tag = "tag:yaml.org,2002:" + tag.slice(2);
        }
        type = schema.compiledTypeMap["fallback"][tag];
        if (type && _hasOwnProperty.call(type.styleAliases, style)) {
          style = type.styleAliases[style];
        }
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      var string, handle, length;
      string = character.toString(16).toUpperCase();
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
    function State(options) {
      this.schema = options["schema"] || DEFAULT_FULL_SCHEMA;
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
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
      while (position < length) {
        next = string.indexOf("\n", position);
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
      var index, length, type;
      for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        type = state.implicitTypes[index];
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
      return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== 65279 || 65536 <= c && c <= 1114111;
    }
    function isNsChar(c) {
      return isPrintable(c) && !isWhitespace(c) && c !== 65279 && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev) {
      return isPrintable(c) && c !== 65279 && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_COLON && (c !== CHAR_SHARP || prev && isNsChar(prev));
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== 65279 && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function needIndentIndicator(string) {
      var leadingSpaceRe = /^\n* /;
      return leadingSpaceRe.test(string);
    }
    var STYLE_PLAIN = 1;
    var STYLE_SINGLE = 2;
    var STYLE_LITERAL = 3;
    var STYLE_FOLDED = 4;
    var STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType) {
      var i;
      var char, prev_char;
      var hasLineBreak = false;
      var hasFoldableLine = false;
      var shouldTrackWidth = lineWidth !== -1;
      var previousLineBreak = -1;
      var plain = isPlainSafeFirst(string.charCodeAt(0)) && !isWhitespace(string.charCodeAt(string.length - 1));
      if (singleLineOnly) {
        for (i = 0; i < string.length; i++) {
          char = string.charCodeAt(i);
          if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
          plain = plain && isPlainSafe(char, prev_char);
        }
      } else {
        for (i = 0; i < string.length; i++) {
          char = string.charCodeAt(i);
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
          prev_char = i > 0 ? string.charCodeAt(i - 1) : null;
          plain = plain && isPlainSafe(char, prev_char);
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
      }
      if (!hasLineBreak && !hasFoldableLine) {
        return plain && !testAmbiguousType(string) ? STYLE_PLAIN : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) {
        return STYLE_DOUBLE;
      }
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    function writeScalar(state, string, level, iskey) {
      state.dump = (function() {
        if (string.length === 0) {
          return "''";
        }
        if (!state.noCompatMode && DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1) {
          return "'" + string + "'";
        }
        var indent = state.indent * Math.max(1, level);
        var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity)) {
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
      var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      var clip = string[string.length - 1] === "\n";
      var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
      var chomp = keep ? "+" : clip ? "" : "-";
      return indentIndicator + chomp + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      var lineRe = /(\n+)([^\n]*)/g;
      var result = (function() {
        var nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      var prevMoreIndented = string[0] === "\n" || string[0] === " ";
      var moreIndented;
      var match;
      while (match = lineRe.exec(string)) {
        var prefix = match[1], line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      var breakRe = / [^ ]/g;
      var match;
      var start = 0, end, curr = 0, next = 0;
      var result = "";
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
      var result = "";
      var char, nextChar;
      var escapeSeq;
      for (var i = 0; i < string.length; i++) {
        char = string.charCodeAt(i);
        if (char >= 55296 && char <= 56319) {
          nextChar = string.charCodeAt(i + 1);
          if (nextChar >= 56320 && nextChar <= 57343) {
            result += encodeHex((char - 55296) * 1024 + nextChar - 56320 + 65536);
            i++;
            continue;
          }
        }
        escapeSeq = ESCAPE_SEQUENCES[char];
        result += !escapeSeq && isPrintable(char) ? string[i] : escapeSeq || encodeHex(char);
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      var _result = "", _tag = state.tag, index, length;
      for (index = 0, length = object.length; index < length; index += 1) {
        if (writeNode(state, level, object[index], false, false)) {
          if (index !== 0) _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      var _result = "", _tag = state.tag, index, length;
      for (index = 0, length = object.length; index < length; index += 1) {
        if (writeNode(state, level + 1, object[index], true, true)) {
          if (!compact || index !== 0) {
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
      var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
      for (index = 0, length = objectKeyList.length; index < length; index += 1) {
        pairBuffer = "";
        if (index !== 0) pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        objectKey = objectKeyList[index];
        objectValue = object[objectKey];
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
      var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
      if (state.sortKeys === true) {
        objectKeyList.sort();
      } else if (typeof state.sortKeys === "function") {
        objectKeyList.sort(state.sortKeys);
      } else if (state.sortKeys) {
        throw new YAMLException("sortKeys must be a boolean or a function");
      }
      for (index = 0, length = objectKeyList.length; index < length; index += 1) {
        pairBuffer = "";
        if (!compact || index !== 0) {
          pairBuffer += generateNextLine(state, level);
        }
        objectKey = objectKeyList[index];
        objectValue = object[objectKey];
        if (!writeNode(state, level + 1, objectKey, true, true, true)) {
          continue;
        }
        explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
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
      var _result, typeList, index, length, type, style;
      typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (index = 0, length = typeList.length; index < length; index += 1) {
        type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
          state.tag = explicit ? type.tag : "?";
          if (type.represent) {
            style = state.styleMap[type.tag] || type.defaultStyle;
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
    function writeNode(state, level, object, block, compact, iskey) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) {
        detectType(state, object, true);
      }
      var type = _toString.call(state.dump);
      if (block) {
        block = state.flowLevel < 0 || state.flowLevel > level;
      }
      var objectOrArray = type === "[object Object]" || type === "[object Array]", duplicateIndex, duplicate;
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
          var arrayLevel = state.noArrayIndent && level > 0 ? level - 1 : level;
          if (block && state.dump.length !== 0) {
            writeBlockSequence(state, arrayLevel, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowSequence(state, arrayLevel, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object String]") {
          if (state.tag !== "?") {
            writeScalar(state, state.dump, level, iskey);
          }
        } else {
          if (state.skipInvalid) return false;
          throw new YAMLException("unacceptable kind of an object to dump " + type);
        }
        if (state.tag !== null && state.tag !== "?") {
          state.dump = "!<" + state.tag + "> " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      var objects = [], duplicatesIndexes = [], index, length;
      inspectNode(object, objects, duplicatesIndexes);
      for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      var objectKeyList, index, length;
      if (object !== null && typeof object === "object") {
        index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object);
          if (Array.isArray(object)) {
            for (index = 0, length = object.length; index < length; index += 1) {
              inspectNode(object[index], objects, duplicatesIndexes);
            }
          } else {
            objectKeyList = Object.keys(object);
            for (index = 0, length = objectKeyList.length; index < length; index += 1) {
              inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
            }
          }
        }
      }
    }
    function dump(input, options) {
      options = options || {};
      var state = new State(options);
      if (!state.noRefs) getDuplicateReferences(input, state);
      if (writeNode(state, 0, input, true, true)) return state.dump + "\n";
      return "";
    }
    function safeDump(input, options) {
      return dump(input, common.extend({ schema: DEFAULT_SAFE_SCHEMA }, options));
    }
    module2.exports.dump = dump;
    module2.exports.safeDump = safeDump;
  }
});

// ../scripts/node_modules/js-yaml/lib/js-yaml.js
var require_js_yaml = __commonJS({
  "../scripts/node_modules/js-yaml/lib/js-yaml.js"(exports2, module2) {
    "use strict";
    var loader = require_loader();
    var dumper = require_dumper();
    function deprecated(name) {
      return function() {
        throw new Error("Function " + name + " is deprecated and cannot be used.");
      };
    }
    module2.exports.Type = require_type();
    module2.exports.Schema = require_schema();
    module2.exports.FAILSAFE_SCHEMA = require_failsafe();
    module2.exports.JSON_SCHEMA = require_json();
    module2.exports.CORE_SCHEMA = require_core();
    module2.exports.DEFAULT_SAFE_SCHEMA = require_default_safe();
    module2.exports.DEFAULT_FULL_SCHEMA = require_default_full();
    module2.exports.load = loader.load;
    module2.exports.loadAll = loader.loadAll;
    module2.exports.safeLoad = loader.safeLoad;
    module2.exports.safeLoadAll = loader.safeLoadAll;
    module2.exports.dump = dumper.dump;
    module2.exports.safeDump = dumper.safeDump;
    module2.exports.YAMLException = require_exception();
    module2.exports.MINIMAL_SCHEMA = require_failsafe();
    module2.exports.SAFE_SCHEMA = require_default_safe();
    module2.exports.DEFAULT_SCHEMA = require_default_full();
    module2.exports.scan = deprecated("scan");
    module2.exports.parse = deprecated("parse");
    module2.exports.compose = deprecated("compose");
    module2.exports.addConstructor = deprecated("addConstructor");
  }
});

// ../scripts/node_modules/js-yaml/index.js
var require_js_yaml2 = __commonJS({
  "../scripts/node_modules/js-yaml/index.js"(exports2, module2) {
    "use strict";
    var yaml3 = require_js_yaml();
    module2.exports = yaml3;
  }
});

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  let current = path.resolve(startCwd);
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const guildDir = path.join(current, ".guild");
    if (fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) {
          return current;
        }
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

// lib/run-trace.ts
var fs6 = __toESM(require("fs"));
var path7 = __toESM(require("path"));

// ../scripts/lib/run-lifecycle.ts
var crypto2 = __toESM(require("crypto"));
var fsNode = __toESM(require("fs"));
var path6 = __toESM(require("path"));

// ../scripts/lib/core/settings-reader.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// ../scripts/lib/host-capabilities-schema.ts
var CLAUDE_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "claude",
  family: "claude",
  surface_kind: "cli",
  package: { installable: true, installability: "verified", manifest_format: "claude-plugin" },
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
  package: { installable: false, installability: "target", manifest_format: "codex-plugin" },
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
    // Verified-by-design: Codex hook taxonomy differs from Claude; no native
    // Claude-equivalent hooks. All degrade through the HookEmitter (ADR Surface 3).
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

// ../scripts/lib/host-registry-schema.ts
var HOST_IDS = [
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
var HOST_FAMILIES = ["claude", "codex", "agents", "pi", "antigravity"];
var CLAUDE_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-cli",
  family: "claude",
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
    package: { installable: false, installability: "target", manifest_format: `${host_kind}-package` },
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
  // `agents-file` is the universal AGENTS.md package target — a FILE surface, not a CLI.
  surface_kind: "file",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "target",
  result_adapter: false,
  // INFERRED — no cross-review adapter; verify at live-host availability.
  dispatch_selectable: true,
  // INFERRED — a host consuming AGENTS.md can run a lane.
  capabilities: inferredCaps("agents-file", "agents", "file"),
  // file surface — matches top-level surface_kind.
  provenance: "inferred"
};
var PI_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "pi-cli",
  family: "pi",
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
    structured_output: { native_json: true, schema_validation: false, repair_prompt: true }
    // --mode json
  },
  provenance: "verified"
  // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};
var ANTIGRAVITY_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "antigravity-cli",
  family: "antigravity",
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
      launch_modes: { bypass_all: ["--dangerously-skip-permissions"] }
    }
  },
  provenance: "verified"
  // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};
var CLAUDE_APP_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-app",
  family: "claude",
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
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
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
  "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY
};
var HOST_ID_SET = new Set(HOST_IDS);
var FAMILY_SET = new Set(HOST_FAMILIES);

// ../scripts/lib/host-id-namespace.ts
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

// ../scripts/lib/host-profiles-validate.ts
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

// ../scripts/lib/shared/safe-object.ts
var PROTO_POISON_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);

// ../scripts/lib/shared/config-defaults.ts
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
var DEFAULTS = {
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
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
    tiers: {
      cheap: { "claude-code-cli": "haiku", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null },
      mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null },
      powerful: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null }
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
    allowed_tools: []
  }
};

// ../scripts/lib/core/settings-reader.ts
var yaml = require_js_yaml2();
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
  "allowed_tools"
  // R-020
]);
function isPlainObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const result = Object.assign(/* @__PURE__ */ Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (isPlainObject2(v) && isPlainObject2(result[k])) {
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
    if (isPlainObject2(v)) {
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
function discoverWorkspace(startDir) {
  let current = path2.dirname(startDir);
  const fsRoot = path2.parse(current).root;
  while (current !== fsRoot) {
    const manifestPath = path2.join(current, ".guild", "workspace.json");
    if (fs2.existsSync(manifestPath)) {
      let manifest = null;
      try {
        manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
      } catch {
        const parent2 = path2.dirname(current);
        if (parent2 === current) break;
        current = parent2;
        continue;
      }
      if (manifest.is_workspace === true) {
        return { rootDir: current, manifest };
      }
      return null;
    }
    const parent = path2.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function parseSettingsFile(filePath) {
  if (!fs2.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs2.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
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
  if (isPlainObject2(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"]);
  if (isPlainObject2(parsed["host_profiles"]))
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
  if (isPlainObject2(parsed["workspace"])) {
    const ws = parsed["workspace"];
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject2(parsed["models"])) {
    const rawModels = parsed["models"];
    const sparse = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject2(rawModels["tiers"])) {
      const rt = rawModels["tiers"];
      const sparseTiers = {};
      for (const tier of ["cheap", "mid", "powerful"]) {
        if (isPlainObject2(rt[tier])) {
          sparseTiers[tier] = sparseTierHostMap(rt[tier]);
        }
      }
      sparse.tiers = sparseTiers;
    }
    if (isPlainObject2(rawModels["scoreWeights"]))
      sparse.scoreWeights = rawModels["scoreWeights"];
    if (isPlainObject2(rawModels["thresholds"]))
      sparse.thresholds = rawModels["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"]))
      sparse.escalationMarkers = rawModels["escalationMarkers"];
    if (typeof rawModels["recallBeforeRead"] === "boolean")
      sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number")
      sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean")
      sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject2(rawModels["cacheTTL"])) {
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
    if (isPlainObject2(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"];
      const sotMerged = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject2(sot[taskType])) continue;
        const innerRaw = sot[taskType];
        const innerMerged = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier];
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    if (isPlainObject2(rawModels["knowledge"])) {
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
  if (isPlainObject2(parsed["security"])) {
    const rawSec = parsed["security"];
    const sparseSec = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec;
  }
  if (isPlainObject2(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"];
    const sparseSp = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp;
  }
  if (isPlainObject2(parsed["mcp"])) {
    const rawMcp = parsed["mcp"];
    const sparseMcp = {};
    if (isPlainObject2(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"];
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean") sparseMcp.http_available = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"];
    out.mcp = sparseMcp;
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
  if (isPlainObject2(parsed["defaults"])) {
    const rawDefaults = parsed["defaults"];
    const sparseDefaults = {};
    for (const k of Object.keys(rawDefaults)) {
      if (DEFAULTS_ALLOWED_KEYS.has(k)) sparseDefaults[k] = rawDefaults[k];
    }
    out.defaults = sparseDefaults;
  }
  return out;
}
function parseLocalFile(guildDir) {
  const localPath = path2.join(guildDir, "settings.local.json");
  if (!fs2.existsSync(localPath)) return {};
  let localParsed;
  try {
    localParsed = JSON.parse(fs2.readFileSync(localPath, "utf8"));
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
  if (isPlainObject2(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"]);
  if (isPlainObject2(parsed["host_profiles"]))
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
  if (isPlainObject2(parsed["workspace"])) {
    const ws = parsed["workspace"];
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject2(parsed["models"])) {
    const rawModels = parsed["models"];
    const sparse = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject2(rawModels["tiers"])) {
      const rt = rawModels["tiers"];
      const sparseTiers = {};
      for (const tier of ["cheap", "mid", "powerful"]) {
        if (isPlainObject2(rt[tier])) sparseTiers[tier] = sparseTierHostMap(rt[tier]);
      }
      sparse.tiers = sparseTiers;
    }
    if (isPlainObject2(rawModels["scoreWeights"])) sparse.scoreWeights = rawModels["scoreWeights"];
    if (isPlainObject2(rawModels["thresholds"])) sparse.thresholds = rawModels["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"])) sparse.escalationMarkers = rawModels["escalationMarkers"];
    if (typeof rawModels["recallBeforeRead"] === "boolean") sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number") sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean") sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject2(rawModels["cacheTTL"])) {
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
    if (isPlainObject2(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"];
      const sotMerged = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject2(sot[taskType])) continue;
        const innerRaw = sot[taskType];
        const innerMerged = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier];
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    if (isPlainObject2(rawModels["knowledge"])) {
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
  if (isPlainObject2(parsed["security"])) {
    const rawSec = parsed["security"];
    const sparseSec = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec;
  }
  if (isPlainObject2(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"];
    const sparseSp = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp;
  }
  if (isPlainObject2(parsed["mcp"])) {
    const rawMcp = parsed["mcp"];
    const sparseMcp = {};
    if (isPlainObject2(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"];
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean") sparseMcp.http_available = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"];
    out.mcp = sparseMcp;
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
  if (isPlainObject2(parsed["defaults"])) {
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
  const resolved = path2.resolve(candidatePath);
  const resolvedBase = path2.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path2.sep);
}
function initiativeIsWorkspaceScoped(workspaceRoot, id) {
  try {
    if (!isValidInitiativeId(id)) return false;
    const registryPath = path2.join(
      workspaceRoot,
      ".guild",
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs2.existsSync(registryPath)) {
      try {
        const raw = fs2.readFileSync(registryPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject2(parsed)) {
          const list = parsed["initiatives"];
          if (Array.isArray(list)) {
            for (const entry of list) {
              if (!isPlainObject2(entry)) continue;
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
    const initiativesBase = path2.join(workspaceRoot, ".guild", "initiatives");
    const activePath = path2.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path2.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );
    const activeBase = path2.join(initiativesBase, "active");
    const archivedBase = path2.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      return false;
    }
    let yamlPath = null;
    if (isContainedIn(activePath, activeBase) && fs2.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs2.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }
    if (yamlPath !== null) {
      try {
        const raw = fs2.readFileSync(yamlPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject2(parsed)) {
          const doc = parsed["initiative"];
          if (isPlainObject2(doc)) {
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
    const wsGuildDir = path2.join(ws.rootDir, ".guild");
    const rawWsSettings = parseSettingsFile(path2.join(wsGuildDir, "settings.json"));
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
  const projectGuildDir = path2.join(cwd, ".guild");
  const projectSettings = parseSettingsFile(path2.join(projectGuildDir, "settings.json"));
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

// ../scripts/lib/frontmatter.ts
var yaml2 = __toESM(require_js_yaml2());
function parseYaml(text, opts = {}) {
  try {
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

// lib/security/scrubbed-write.ts
var fs5 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));

// lib/v1.4/redact-log.ts
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

// lib/security/secrets.ts
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

// lib/security/config.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
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
function isPlainObject3(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject3(parsed)) return out;
  if (isPlainObject3(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject3(parsed["secrets_policy"])) {
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
  if (isPlainObject3(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject3(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject3(mcp["tool_description_hashes"])) {
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
  const settingsPath = path3.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs3.readFileSync(settingsPath, "utf8");
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

// lib/security/events.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
var KNOWN_GUILD_HOST_KINDS = [
  "claude",
  // Claude Code (reference impl)
  "codex",
  // OpenAI Codex CLI
  "gemini",
  // Google Gemini CLI
  "pi",
  // Pi (Inflection AI)
  "antigravity-2",
  // Antigravity 2.0
  "claude-code-desktop",
  // Claude Code Desktop app
  "claude-code-web",
  // Claude Code Web (cloud VM)
  "codex-app",
  // Codex desktop app
  "claude-ai-connector"
  // claude.ai connector (remote MCP control plane)
];
function resolveHostResolution(env) {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude", degraded: false, rawUnknown: "" };
  if (KNOWN_GUILD_HOST_KINDS.includes(rawHost)) {
    return { id: rawHost, degraded: false, rawUnknown: "" };
  }
  return { id: "claude", degraded: true, rawUnknown: rawHost };
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
    const logsDir2 = path4.join(runDir3, "logs");
    fs4.mkdirSync(logsDir2, { recursive: true });
    fs4.appendFileSync(path4.join(logsDir2, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// lib/security/scrubbed-write.ts
function guildRootFromRunDir(runDir3) {
  return path5.resolve(runDir3, "../../..");
}
function writeScrubApprovalRequest(runDir3, runId, surface, outPath, laneId) {
  try {
    const approvalDir = path5.join(runDir3, "agent-bus", "approvals");
    fs5.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path5.basename(outPath)}`,
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
    fs5.writeFileSync(path5.join(approvalDir, fileName), content, "utf8");
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
      fs5.mkdirSync(path5.dirname(outPath), { recursive: true });
      fs5.writeFileSync(outPath, scrubResult.value, "utf8");
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
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path5.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs5.mkdirSync(path5.dirname(outPath), { recursive: true });
      fs5.writeFileSync(outPath, scrubResult.value, "utf8");
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
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path5.basename(outPath)}. Built-in-redacted content written.`,
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
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path5.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}

// ../scripts/lib/run-lifecycle.ts
function runDir(root, runId) {
  return path6.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path6.join(runDir(root, runId), "run.yaml");
}
function provenancePath(root, runId) {
  return path6.join(runDir(root, runId), "provenance.json");
}
function logsDir(root, runId) {
  return path6.join(runDir(root, runId), "logs");
}
function resolvedSettingsPath(root, runId) {
  return path6.join(runDir(root, runId), "resolved-settings.json");
}
function sentinelPath(root) {
  return path6.join(root, ".guild", "runs", "current-run-id");
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
  return `run-${crypto2.randomUUID()}`;
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
      const root = resolveCloseRoot(env, runId);
      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();
      const finalCheckpoint = runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;
      const terminalTraceEvent = {
        event_id: `evt-${crypto2.randomUUID()}`,
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
        const runDir3 = path6.join(root, ".guild", "runs", runId);
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
    }
  };
}
function resolveCloseRoot(env, runId) {
  const hint = env.__rootHint;
  if (hint) return hint;
  const cwd = resolveGuildRoot(process.cwd());
  if (env.fs.exists(runYamlPath(cwd, runId))) return cwd;
  return cwd;
}
function createRealEnv(root, resolveHost) {
  const env = {
    now: () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fs: {
      mkdirp(absPath) {
        fsNode.mkdirSync(absPath, { recursive: true });
      },
      writeFile(absPath, contents) {
        fsNode.mkdirSync(path6.dirname(absPath), { recursive: true });
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
  const resolvedTarget = path6.resolve(target);
  const resolvedBase = path6.resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + path6.sep)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" escapes runs base "${resolvedBase}"`
    );
  }
}
function realProvenanceFsSeam() {
  return {
    writeFile(absPath, contents) {
      fsNode.mkdirSync(path6.dirname(absPath), { recursive: true });
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
  const fs7 = fsSeam ?? realProvenanceFsSeam();
  const outPath = resolvedSettingsPath(cwd, runId);
  const runsBase = path6.resolve(cwd, ".guild", "runs");
  assertContained(outPath, runsBase, "writeResolvedSettingsSnapshot");
  const onDisk = {
    ...snapshot,
    resolved_at_ref: resolvedAtRef ?? runId
  };
  const serialized = JSON.stringify(onDisk, null, 2) + "\n";
  if (fs7.scrubbedWriteDurable) {
    const runDir3 = path6.join(cwd, ".guild", "runs", runId);
    const result = fs7.scrubbedWriteDurable(outPath, serialized, "config", runDir3, runId);
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: resolved-settings.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
      );
    }
  } else {
    fs7.writeFile(outPath, serialized);
  }
  return outPath;
}
function readRecordStatusRuns(root) {
  try {
    const { config } = resolveSettings({ cwd: root });
    return config.record_status_runs;
  } catch {
    return true;
  }
}

// lib/run-trace.ts
function runDir2(root, runId) {
  return path7.join(root, ".guild", "runs", runId);
}
function liveLogPath(root, runId) {
  return path7.join(runDir2(root, runId), "logs", "v1.4-events.jsonl");
}
function provenancePath2(root, runId) {
  return path7.join(runDir2(root, runId), "provenance.json");
}
function skippedFilesPath(root, runId) {
  return path7.join(runDir2(root, runId), "learn", "skipped-files.json");
}
function resolveRunIdForTrace(root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const legacy = readSentinel(path7.join(root, ".guild", "runs", "current-run-id"));
  if (legacy) return legacy;
  const b2 = readSentinel(path7.join(root, ".guild", "current-run-id"));
  if (b2) return b2;
  return null;
}
function readSentinel(p) {
  try {
    const v = fs6.readFileSync(p, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
function defaultResolveHost(requested) {
  const raw = (process.env["GUILD_HOST"] ?? requested ?? "").trim().toLowerCase();
  const resolved = raw === "codex" ? "codex" : raw === "gemini" ? "gemini" : raw === "pi" ? "pi" : "claude";
  return { requested, resolved };
}
function appendTraceLine(file, event) {
  fs6.mkdirSync(path7.dirname(file), { recursive: true });
  fs6.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
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
    const prov = JSON.parse(fs6.readFileSync(provenancePath2(root, runId), "utf8"));
    const pointer = prov.terminal_trace_event;
    if (!pointer || typeof pointer.event_id !== "string") {
      process.stderr.write(
        `[run-trace] WARN: provenance.json missing terminal_trace_event pointer for ${runId}
`
      );
      return;
    }
    appendTraceLine(liveLogPath(root, runId), {
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
function startRunOnly(root, resolveHost, opts = {}) {
  try {
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
    run_class: runClass
  };
}
function recordPhase(root, phase, opts = {}) {
  try {
    const runId = opts.runId ?? resolveRunIdForTrace(root, opts.env ?? process.env);
    if (!runId) return null;
    const lifecycleEnv = createRealEnv(root, defaultResolveHost);
    return appendPhase(lifecycleEnv, root, runId, phase) ? runId : null;
  } catch {
    return null;
  }
}
function startAndCloseRun(root, resolveHost, opts = {}) {
  try {
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
  fs6.mkdirSync(path7.dirname(out), { recursive: true });
  fs6.writeFileSync(out, JSON.stringify(body, null, 2) + "\n", "utf8");
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
  return new Promise((resolve5) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve5(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve5(""));
  });
}
var USAGE = "usage: run-trace.ts <start|status|phase|skipped> [--cwd <root>] [--run-id <id>]\n  start   --command=/guild:plan [--phase=<p>] [--run-class=full|lightweight] [--cwd <root>]\n  status  [--cwd <root>]   (alias: start --run-class=lightweight + OQ6 gate)\n  phase   --phase=<init|ideate|plan|build|qa|ops> [--run-id <id>] [--cwd <root>]\n  skipped --run-id <id>    [--cwd <root>] < entries.json\n";
async function main() {
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
    const runId = runClass === "lightweight" ? startAndCloseRun(root, defaultResolveHost, {
      command,
      cwd,
      run_class: "lightweight",
      initiative
    }) : startRunOnly(root, defaultResolveHost, {
      command,
      cwd,
      run_class: "full",
      initiative,
      phase
      // T0: seed run.yaml phase: + first phases_log entry (canonical-validated downstream)
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
main().catch((err) => {
  process.stderr.write(
    `[run-trace] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
