/**
 * scripts/learn/lib/extract-require.test.ts
 *
 * #218: every static `require("<literal>")` in JS/TS yields an import edge,
 * not only the `const|let|var x = require(...)` declaration form.
 */
import { test, expect } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeSource } from "./extract";
import { buildImportMap } from "./import-map";

const sources = (code: string) =>
  analyzeSource("src/a.js", code)!.imports.map((i) => i.source);

test("#218 repro: module.exports = require('./b') yields a/b edge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x218-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.js"), "module.exports = require('./b')\n");
  fs.writeFileSync(path.join(root, "src/b.js"), "module.exports = 41\n");
  try {
    const edges = buildImportMap(root, ["src/a.js", "src/b.js"]);
    expect(edges).toEqual([{ from: "src/a.js", to: "src/b.js", kind: "static" }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bare, call-argument, and multiple requires on one line are detected", () => {
  expect(sources("require('./setup');\n")).toEqual(["./setup"]);
  expect(sources("app.use(require(\"./x\"));\n")).toEqual(["./x"]);
  expect(sources("module.exports = { a: require('./a1'), b: require('./b1') };\n")).toEqual([
    "./a1",
    "./b1",
  ]);
});

test("declaration form keeps its specifiers and is not double-counted", () => {
  const imps = analyzeSource("src/a.js", "const { sum } = require('./sum');\n")!.imports;
  expect(imps).toEqual([{ source: "./sum", specifiers: ["sum"] }]);
});

test("non-static and member requires are not edges", () => {
  expect(sources("const m = require(name);\n")).toEqual([]);
  expect(sources("x.require('./nope');\n")).toEqual([]);
  expect(sources("// require('./commented')\n")).toEqual([]);
});

test("codex F2: strings, spaced member calls, spaced parens, import+require lines", () => {
  expect(sources(`const s = "require('./fake')";\n`)).toEqual([]);
  expect(sources("const t = `require('./tpl')`;\n")).toEqual([]);
  expect(sources("x. require('./member');\n")).toEqual([]);
  expect(sources("x\n  .require('./member2');\n")).toEqual([]); // line 2 starts with "."
  expect(sources(`require ("./real");\n`)).toEqual(["./real"]);
  expect(sources(`import a from "./a"; const b = require("./b");\n`)).toEqual(["./a", "./b"]);
  expect(sources(`foo(); /* require('./c') */ require('./d');\n`)).toEqual(["./d"]);
});

test("codex round 2: lexical state spans lines", () => {
  expect(sources(`/*\nrequire("./fake")\n*/\n`)).toEqual([]);
  expect(sources("const t = `line1\nrequire('./tpl')\n`;\n")).toEqual([]);
  expect(sources(`obj.\nrequire("./fake");\n`)).toEqual([]);
  expect(sources("const t = `${require('./real')}`;\n")).toEqual(["./real"]);
  expect(sources("const t = `a ${ {x: require('./obj')}.x } b`;\nrequire('./after');\n")).toEqual(["./obj", "./after"]);
  // Edge lands on the right line in the analysis (import map keys by file, but keep order sane).
  expect(sources("// c\nconst a = require('./a');\nmodule.exports = require('./b');\n")).toEqual(["./a", "./b"]);
});

test("codex round 3: CRLF continuations and multi-line require spans keep line state", () => {
  expect(sources("const s = 'a\\\r\nrequire(\"./fake\")';\nrequire('./real');\n")).toEqual(["./real"]);
  expect(sources("const s = 'a\\\nrequire(\"./fake\")';\n")).toEqual([]);
  const imps = analyzeSource("src/a.js", "require(\n  './x'\n);\nconst { sum } = require(\"./sum\");\n")!.imports;
  expect(imps).toEqual([
    { source: "./x", specifiers: [] },
    { source: "./sum", specifiers: ["sum"] },
  ]);
});

test("codex round 4: spread and comment trivia inside the call", () => {
  expect(sources(`module.exports = { ...require("./b") };\n`)).toEqual(["./b"]);
  expect(sources(`require(/* module */ "./b");\n`)).toEqual(["./b"]);
  expect(sources(`require /* c */ ( './c' /* d */ );\n`)).toEqual(["./c"]);
  expect(sources(`x.require("./member");\n`)).toEqual([]);
});

test("codex round 5: comment trivia never crosses */, line comments, quotes, trailing comma", () => {
  expect(sources(`require(/* a */ dynamic); other(/* b */ "./fake");\n`)).toEqual([]);
  expect(sources(`require(// comment\n"./real");\n`)).toEqual(["./real"]);
  expect(sources(`require("./it's");\n`)).toEqual(["./it's"]);
  expect(sources(`require("./real",);\n`)).toEqual(["./real"]);
});

test("codex round 6: escaped quotes never close the literal", () => {
  // The escaped quote keeps the first string open; "./fake" is string content.
  expect(sources(`require("./x\\"); require('./fake')");\n`)).toEqual([String.raw`./x\"); require('./fake')`]);
  expect(sources(`require('./a\\'b');\n`)).toEqual([String.raw`./a\'b`]);
});
