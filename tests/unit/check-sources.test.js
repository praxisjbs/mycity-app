"use strict";
/**
 * The source reader behind the static halves of the screen gates
 * (scripts/check/lib/sources.js): literals must be found exactly, and
 * comments and regular expressions must never be mistaken for copy.
 */
const { scan, callArgs, literalText, isPureLiteral, functionRanges } = require("../../scripts/check/lib/sources");

describe("scan", () => {
  test("returns string literals and skips comments", () => {
    const { literals } = scan(`// 'not copy'\nvar a='Clock In'; /* "nor this" */ var b="Clock Out";`);
    expect(literals.map((l) => l.value)).toEqual(["Clock In", "Clock Out"]);
  });

  test("does not read a regular expression as a string", () => {
    const { literals } = scan(`var r=/'/g, s='real';`);
    expect(literals.map((l) => l.value)).toEqual(["real"]);
  });

  test("treats a slash after a value as division", () => {
    const { literals } = scan(`var x=a/2, s='after';`);
    expect(literals.map((l) => l.value)).toEqual(["after"]);
  });

  test("keeps the static parts of a template literal", () => {
    const { literals } = scan("var t=`Hello ${name}, welcome`;");
    expect(literals[0].value).toBe("Hello  , welcome");
  });

  test("blanks comments but keeps offsets", () => {
    const src = "a/* x */b";
    expect(scan(src).code).toHaveLength(src.length);
  });
});

describe("callArgs", () => {
  test("splits top-level arguments and respects nesting", () => {
    const code = `field('when','Start Date','<input value="a,b">'+x(1,2),'Not a real date')`;
    const args = callArgs(code, code.indexOf("("));
    expect(args).toHaveLength(4);
    expect(literalText(args[1])).toBe("Start Date");
    expect(isPureLiteral(args[1])).toBe(true);
    expect(isPureLiteral(args[2])).toBe(false);
  });
});

describe("functionRanges", () => {
  test("finds a named function's body", () => {
    const code = "function field(a){return '<label>'+a+'</label>'} function other(){}";
    const [[start, end, name]] = functionRanges(code, ["field"]);
    expect(name).toBe("field");
    expect(code.slice(start, end)).toContain("<label>");
    expect(code.slice(start, end)).not.toContain("other");
  });
});
