"use strict";
/**
 * The pure logic of the frontend gates added with packages/ui
 * (FRONTEND_FOUNDATION PR 1): palette (13), native dialogs (16), upload (18),
 * mock-free (F12), the gallery target of the screen crawl (F10, F23), the
 * a11y report and the copy props gate 8 reads from source. A scanner that
 * misses a case passes a broken screen; one that over-reaches fails good work,
 * so both edges are pinned here.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { jsxProps, frontendFiles } = require("../../scripts/check/lib/sources");
const { findHex, findStyling, tokenValues, grown, HEX_ALLOWED } = require("../../scripts/check/palette");
const { findDialogs } = require("../../scripts/check/native-dialogs");
const { findFileInputs, uploadHome, LEGACY_UPLOADS } = require("../../scripts/check/upload");
const { sentinelOf, filesWith } = require("../../scripts/check/mock-free");
const { demoWanted } = require("../../scripts/check/lib/screens");
const { isStale } = require("../../scripts/check/lib/gallery");
const { merge } = require("../../scripts/check/a11y");

/** The linter's own patterns, read from packages/ui/eslint.shared.js (ESM, so not require-able here). */
function lintPattern(name) {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "packages", "ui", "eslint.shared.js"), "utf8");
  const m = new RegExp(`export const ${name} = /(.*)/([a-z]*);`).exec(src);
  if (!m) throw new Error(`${name} is no longer exported from eslint.shared.js`);
  return new RegExp(m[1], m[2]);
}
const HEX = lintPattern("HEX");
const ARBITRARY = lintPattern("ARBITRARY");

describe("frontendFiles", () => {
  test("covers the design system and both apps, never tests", () => {
    const files = frontendFiles();
    expect(files.some((f) => f.startsWith("packages/ui/src/"))).toBe(true);
    expect(files.some((f) => f.startsWith("app/src/"))).toBe(true);
    expect(files.some((f) => /\.test\.[jt]sx?$/.test(f))).toBe(false);
  });
});

describe("jsxProps (gate 8 static copy)", () => {
  test("reads string props, including through arrow functions and nested elements", () => {
    const code = `<Card title="Leave Requests" onClick={() => go(a > 1)} actions={<Button title="Inner" />} />
      <CardHeader title={"Team"} help={\`Approved this month\`} />
      <PageHeader title="My Attendance" subtitle={sub} />`;
    const got = jsxProps(code, ["Card", "CardHeader", "PageHeader"]).map((p) => `${p.component}.${p.prop}=${p.value}`);
    expect(got).toEqual(["Card.title=Leave Requests", "CardHeader.title=Team", "CardHeader.help=Approved this month", "PageHeader.title=My Attendance"]);
  });

  test("does not mistake a longer name or a member for the component", () => {
    expect(jsxProps(`<Cards title="x" /><Card.Body title="y" />`, ["Card"])).toEqual([]);
  });

  test("skips template literals with expressions (known only at run time)", () => {
    expect(jsxProps("<Card title={`Hello ${name}`} />", ["Card"])).toEqual([]);
  });
});

describe("palette (gate 13)", () => {
  test("finds hex colours but not entities, private names or anchors that are words", () => {
    const text = `color: #FFDF55; a: #fff; b: &#123; this.#add; href="#/Button" c: #01221dff`;
    expect(findHex(text, HEX).map((h) => h.value)).toEqual(["#FFDF55", "#fff", "#01221dff"]);
  });

  test("reads token values from tokens.css", () => {
    const set = tokenValues(":root {\n  --primary: #FFDF55; /* x */\n  --ring: #014339;\n}");
    expect([...set]).toEqual(["#FFDF55", "#014339"]);
  });

  test("finds arbitrary-value classes and style props, not variables or variants", () => {
    const src = [
      'const a = <div className="w-[317px] p-4" />;',
      'const b = <div className="data-[state=open]:bg-muted w-[var(--rail)]" />;',
      "const c = <div style={{ width: 3 }} />;",
      "const style = { width: 3 };",
      '// <div className="h-[3px]" style={{}} />',
      'const d = "explains style=x in words";',
    ].join("\n");
    expect(findStyling(src, ARBITRARY).map((f) => f.what)).toEqual(['arbitrary value "w-[317px]"', "inline style= prop"]);
  });

  test("the exemption list only shrinks", () => {
    expect(grown(["a.tsx", "b.tsx"], ["b.tsx"])).toEqual([]);
    expect(grown(["a.tsx"], ["a.tsx", "c.tsx"])).toEqual(["c.tsx"]);
  });

  test("every allowed file gives its reason", () => {
    for (const a of HEX_ALLOWED) expect(a.why.length).toBeGreaterThan(20);
  });
});

describe("native dialogs (gate 16)", () => {
  const what = (src) => findDialogs(src).map((f) => f.what);

  test("refuses the bare calls and every global alias", () => {
    expect(what('alert("Saved");')).toEqual(["alert()"]);
    expect(what("if (window.confirm('Delete?')) go();")).toEqual(["window.confirm"]);
    expect(what("const ask = globalThis?.prompt;")).toEqual(["globalThis.prompt"]);
    expect(what('self["confirm"]("x");')).toEqual(['self["confirm"]']);
    expect(what("const { confirm } = window; confirm('x');")).toEqual(["confirm taken off window", "confirm()"]);
  });

  test("allows the shared confirm, methods and look-alikes", () => {
    expect(what("const confirm = useConfirm(); await confirm({ title: 'Delete Rule' });")).toEqual([]);
    expect(what("import { confirm } from './x'; confirm();")).toEqual([]);
    expect(what("const api = { confirm() { return 1; } };")).toEqual([]);
    expect(what("modal.confirm(); useConfirm(); onConfirm();")).toEqual([]);
    expect(what('// alert("x")\nconst s = "do not alert(anyone)";')).toEqual([]);
  });
});

describe("upload (gate 18)", () => {
  test("finds JSX and DOM-built file inputs, not comments or other types", () => {
    const src = ['<input type="file" />', "<input type={'file'} />", 'el.type = "file";', 'el.setAttribute("type", "file");', '// <input type="file" />', '<input type="text" />', 'const doc = { kind: "file" };'].join("\n");
    expect(findFileInputs(src).map((f) => f.what)).toEqual(['type="file"', 'type="file"', '.type = "file"', 'setAttribute("type", "file")']);
  });

  test("allows only the form system and the legacy upload files", () => {
    expect(uploadHome("packages/ui/src/form/UploadField.tsx")).toBe(true);
    for (const f of LEGACY_UPLOADS) expect(uploadHome(f)).toBe(true);
    expect(uploadHome("app/src/features/ess/Documents.tsx")).toBe(false);
    expect(uploadHome("packages/ui/src/display/Avatar.tsx")).toBe(false);
  });
});

describe("mock-free (F12)", () => {
  test("reads the sentinel a mock core declares", () => {
    expect(sentinelOf('export const MOCK_SENTINEL = "mycity-in-browser-mock:app";')).toBe("mycity-in-browser-mock:app");
    expect(sentinelOf("const MOCK = 1;")).toBeNull();
  });

  test("finds the sentinel in a build's files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-free-test-"));
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "assets", "a.js"), 'console.error("[mycity-in-browser-mock:app]")');
      fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
      expect(filesWith(dir, "mycity-in-browser-mock:app")).toEqual(["assets/a.js"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("screen crawl targets (F10, F23)", () => {
  const DEMO = "docs/MyCity-ERP-Documents/demo.html";

  test("crawls demo.html only when the change touches it, or when asked", () => {
    expect(demoWanted([{ path: "app/src/x.tsx", status: "M" }], [], {})).toBe(false);
    expect(demoWanted([{ path: DEMO, status: "M" }], [], {})).toBe(true);
    expect(demoWanted([], ["--demo"], {})).toBe(true);
    expect(demoWanted([], [], { MYCITY_DEMO: "1" })).toBe(true);
  });

  test("crawls it when git cannot say what changed, rather than skip it unseen", () => {
    expect(demoWanted(null, [], {})).toBe(true);
  });

  test("rebuilds the gallery when its build is missing or its inputs changed", () => {
    expect(isStale("abc\n", "abc", true)).toBe(false);
    expect(isStale("abc", "def", true)).toBe(true);
    expect(isStale(null, "abc", true)).toBe(true);
    expect(isStale("abc", "abc", false)).toBe(true);
  });
});

describe("a11y report", () => {
  test("reports one line per rule, component and element, with every place it was seen", () => {
    const v = (width, density) => ({
      id: "button-name",
      impact: "critical",
      help: "Buttons must have discernible text",
      component: "IconButton",
      width,
      density,
      nodes: [{ target: "button.x", state: "Default, dark", summary: "Fix" }],
    });
    const lines = merge([v("phone", "compact"), v("desktop", "comfortable")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].seen).toEqual(["phone compact", "desktop comfortable"]);
  });
});
