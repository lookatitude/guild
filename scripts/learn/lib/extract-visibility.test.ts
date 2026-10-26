/**
 * I14 (legacy G2 R4-R5): analyzeGeneric sets `exported` from language
 * visibility only (pub / public / export keyword, Go capitalization) and
 * otherwise false — it never invents `exported: true`.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeSource } from "./extract";
import { extractFunctionIds } from "../content-analyze";

const exportedOf = (file: string, code: string): Record<string, boolean> => {
  const a = analyzeSource(file, code)!;
  const out: Record<string, boolean> = {};
  for (const f of a.functions) out[f.name] = f.exported;
  for (const c of a.classes) out[`class ${c.name}`] = c.exported;
  return out;
};

describe("I14 — analyzeGeneric derives exported from visibility, never invents it", () => {
  test("Java: public members exported, private / package-private not", () => {
    const java = [
      "public class Widget {",
      "  public Widget() {",
      "  }",
      "  private Widget(int size) {",
      "  }",
      "  static helper() {",
      "  }",
      "}",
      "class Hidden {",
      "}",
    ].join("\n");
    const e = exportedOf("src/Widget.java", java);
    expect(e["class Widget"]).toBe(true);
    expect(e["class Hidden"]).toBe(false);
    expect(e.helper).toBe(false);
    // Both constructors are named Widget; the private one must not be exported.
    const ctors = analyzeSource("src/Widget.java", java)!.functions.filter((f) => f.name === "Widget");
    expect(ctors.map((f) => f.exported)).toEqual([true, false]);
  });

  test("Rust: `pub` exported; bare `fn` and `pub(crate)` not", () => {
    const e = exportedOf("src/lib.rs", ["pub fn open() {", "}", "fn hidden() {", "}", "pub(crate) fn inner() {", "}", "pub struct Conn {", "}", "struct Raw {", "}"].join("\n"));
    expect(e.open).toBe(true);
    expect(e.hidden).toBe(false);
    expect(e.inner ?? false).toBe(false);
    expect(e["class Conn"]).toBe(true);
    expect(e["class Raw"]).toBe(false);
  });

  test("C#: private / unmarked members not exported", () => {
    const e = exportedOf("src/Svc.cs", ["public class Svc {", "  public Svc() {", "  }", "  private Svc(int x) {", "  }", "}", "interface IThing {", "}"].join("\n"));
    expect(e["class Svc"]).toBe(true);
    expect(e["class IThing"]).toBe(false);
  });

  test("Go: capitalization rule; Swift `func` does NOT borrow it", () => {
    const go = exportedOf("pkg/a.go", ["func Open() {", "}", "func hidden() {", "}"].join("\n"));
    expect(go).toEqual({ Open: true, hidden: false });
    const swift = exportedOf("src/a.swift", ["func Render() {", "}", "public func show() {", "}"].join("\n"));
    expect(swift.Render).toBe(false);
    expect(swift.show).toBe(true);
  });

  test("C: no visibility syntax → never exported", () => {
    const e = exportedOf("src/a.c", ["static helper(int x) {", "}"].join("\n"));
    expect(Object.values(e).every((v) => v === false)).toBe(true);
  });

  test("content-analyze consumer: a Java private method is not an exported function id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-extract-vis-"));
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(
        path.join(dir, "src", "Box.java"),
        ["public class Box {", "  public Box() {", "  }", "  private secret() {", "  }", "}"].join("\n"),
      );
      expect(extractFunctionIds(dir, ["src/Box.java"])).toEqual(["function:src/Box.java:Box"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
