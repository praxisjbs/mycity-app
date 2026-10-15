#!/usr/bin/env node
"use strict";
/**
 * Write docs/COMPONENTS.md, the component catalogue, from packages/ui itself
 * (FRONTEND_FOUNDATION F8): each component file's header and its exported
 * `<Name>Props` interface with the JSDoc line on every prop.
 *
 *   npm run gen:components                   write docs/COMPONENTS.md
 *   node scripts/gen/components.js --check   exit 1 when docs/COMPONENTS.md is stale (CI)
 *
 * A component file is any .tsx under packages/ui/src except tests, gallery
 * pages and src/testing. Its header is the first JSDoc block holding
 * @component (FRONTEND_FOUNDATION SPEC §2):
 *
 *   @component @group @summary @use @avoid @phone @a11y @status   required
 *   @exports  other components exported from the file, comma separated
 *   @example  JSX, may repeat
 *
 * The output depends only on the files, so the same tree writes the same
 * catalogue on every machine: no dates, sorted throughout.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..", "..");
const PKG = path.join(ROOT, "packages", "ui");
const SRC = path.join(PKG, "src");
const OUT = path.join(ROOT, "docs", "COMPONENTS.md");

const GROUPS = ["Foundations", "Actions", "Layout", "Display", "Navigation", "Overlays", "Help", "Feedback", "Forms", "Data", "Shell"];
const STATUSES = ["stable", "beta", "deprecated"];
const REQUIRED = ["component", "group", "summary", "use", "avoid", "phone", "a11y", "status"];
/** Where each group's components live by default (npm run new:component). */
const GROUP_DIRS = {
  Foundations: "icons",
  Actions: "actions",
  Layout: "layout",
  Display: "display",
  Navigation: "navigation",
  Overlays: "overlay",
  Help: "help",
  Feedback: "feedback",
  Forms: "form",
  Data: "data",
  Shell: "shell",
};

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/** Every component file, sorted. */
function componentFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (full !== path.join(SRC, "testing")) walk(full);
      } else if (/\.tsx$/.test(e.name) && !/\.(test|gallery)\.tsx$/.test(e.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/** The header tags of a file: { tag: value } with `example` a list, or null when there is no @component block. */
function parseHeader(source) {
  const blocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
  const block = blocks.find((b) => /@component\b/.test(b));
  if (!block) return null;
  const lines = block
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""));
  const tags = { example: [] };
  let current = null;
  for (const line of lines) {
    const m = /^@(\w+)\s*(.*)$/.exec(line.trim());
    if (m) {
      current = m[1];
      if (current === "example") tags.example.push(m[2]);
      else tags[current] = m[2];
    } else if (current && line.trim()) {
      if (current === "example") tags.example[tags.example.length - 1] += `\n${line.trimEnd()}`;
      else tags[current] = `${tags[current]} ${line.trim()}`.trim();
    }
  }
  for (const k of Object.keys(tags)) if (typeof tags[k] === "string") tags[k] = tags[k].trim();
  tags.exports = tags.exports ? tags.exports.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return tags;
}

/** One TypeScript program over the package, so prop types read as the checker sees them. */
function program(files) {
  const config = ts.readConfigFile(path.join(PKG, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PKG);
  return ts.createProgram({ rootNames: [...files, path.join(SRC, "index.ts")], options: { ...parsed.options, noEmit: true } });
}

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

function jsDocText(node) {
  const docs = node.jsDoc || [];
  const text = docs.map((d) => (typeof d.comment === "string" ? d.comment : ts.getTextOfJSDocComment(d.comment) || "")).join(" ");
  return oneLine(text);
}

/** The props interface `<name>Props` declared in a file: its members and what it extends. */
function propsOf(prog, file, name) {
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  let found = null;
  /** Local aliases of short literal unions (`type ButtonVariant = "default" | ...`), shown expanded. */
  const unions = {};
  ts.forEachChild(sf, (node) => {
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === `${name}Props`) found = node;
    if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type) && node.type.types.every((t) => ts.isLiteralTypeNode(t))) {
      unions[node.name.text] = oneLine(node.type.getText(sf));
    }
  });
  if (!found) return null;
  const members = ts.isInterfaceDeclaration(found) ? found.members : ts.isTypeLiteralNode(found.type) ? found.type.members : [];
  const props = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
    const propName = m.name.getText(sf);
    let type = m.type ? oneLine(m.type.getText(sf)) : "unknown";
    if (unions[type]) type = unions[type];
    if (/\b(keyof|typeof)\b/.test(type) && m.type) {
      type = checker.typeToString(checker.getTypeFromTypeNode(m.type), undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType);
      type = type.replace(/'/g, '"');
    }
    props.push({ name: propName, type, required: !m.questionToken, doc: jsDocText(m) });
  }
  const heritage = ts.isInterfaceDeclaration(found) && found.heritageClauses ? found.heritageClauses.flatMap((h) => h.types.map((t) => oneLine(t.getText(sf)))) : [];
  const exported = (ts.getModifiers(found) || []).some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
  return { name: `${name}Props`, props, extends: heritage, exported };
}

/** Every name the package barrel exports. */
function barrelExports(prog) {
  const checker = prog.getTypeChecker();
  const sf = prog.getSourceFile(path.join(SRC, "index.ts"));
  const sym = sf && checker.getSymbolAtLocation(sf);
  return new Set(sym ? checker.getExportsOfModule(sym).map((s) => s.getName()) : []);
}

/** The exported helpers of src/lib, each with the first line of its JSDoc. */
function helpers(prog) {
  const out = [];
  const dir = path.join(SRC, "lib");
  for (const f of fs.readdirSync(dir).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "index.ts").sort()) {
    const sf = prog.getSourceFile(path.join(dir, f));
    if (!sf) continue;
    ts.forEachChild(sf, (node) => {
      const exported = ts.canHaveModifiers(node) && (ts.getModifiers(node) || []).some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return;
      const names = ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.getText(sf)) : node.name ? [node.name.getText(sf)] : [];
      const doc = jsDocText(ts.isVariableStatement(node) ? node : node) || (ts.isVariableStatement(node) ? jsDocText(node.declarationList.declarations[0]) : "");
      const kind = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ? "type" : "value";
      for (const n of names) out.push({ name: n, file: f, doc: doc.split(/(?<=\.)\s/)[0] || "", kind });
    });
  }
  return out;
}

/** Everything the catalogue and the gate need, read from the package. */
function collect() {
  const files = componentFiles();
  const prog = program(files);
  const components = files.map((file) => {
    const source = fs.readFileSync(file, "utf8");
    const header = parseHeader(source);
    const base = path.basename(file, ".tsx");
    const sibling = (kind) => path.join(path.dirname(file), `${base}.${kind}.tsx`);
    const name = header && header.component ? header.component : base;
    return {
      file,
      rel: rel(file),
      base,
      header,
      name,
      test: fs.existsSync(sibling("test")) ? rel(sibling("test")) : null,
      gallery: fs.existsSync(sibling("gallery")) ? rel(sibling("gallery")) : null,
      props: [name, ...(header ? header.exports : [])].map((n) => ({ component: n, props: propsOf(prog, file, n) })),
    };
  });
  return { components, exported: barrelExports(prog), helpers: helpers(prog) };
}

const cell = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function render({ components, helpers: helperList }) {
  const valid = components.filter((c) => c.header && GROUPS.includes(c.header.group));
  const byGroup = GROUPS.map((g) => [g, valid.filter((c) => c.header.group === g).sort((a, b) => a.name.localeCompare(b.name))]).filter(([, list]) => list.length);
  const out = [];
  out.push("# Component Catalogue");
  out.push("");
  out.push("<!-- GENERATED by scripts/gen/components.js from packages/ui/src. Do not edit; run `npm run gen:components`. -->");
  out.push("");
  out.push("Every shared component of both apps, read from its header and its props in `packages/ui/src`.");
  out.push("Features import from `@mycity/ui` only, and never build their own copy of anything listed here.");
  out.push("");
  out.push("**Need something that is not here?** Add it to the package, never inside a feature:");
  out.push("");
  out.push("```bash");
  out.push("npm run new:component -- --name StatusPill --group Display");
  out.push("```");
  out.push("");
  out.push("That writes the component with its header, a test and a gallery page, exports it from its group,");
  out.push("and regenerates this file. Fill the header, build it, run `npm -w @mycity/ui test` and see it in");
  out.push("`npm run gallery`. `scripts/check/components.js` fails a stale catalogue, a component without a full");
  out.push("header, test or gallery page, and a feature that re-creates or shadows a component listed here.");
  out.push("");
  out.push("## Index");
  out.push("");
  out.push("| Group | Component | Import | Summary | Status |");
  out.push("|---|---|---|---|---|");
  for (const [g, list] of byGroup) {
    for (const c of list) {
      const names = [c.name, ...c.header.exports].map((n) => `\`${n}\``).join(", ");
      out.push(`| ${g} | [${c.name}](#${anchor(c.name)}) | ${names} | ${cell(c.header.summary)} | ${c.header.status} |`);
    }
  }
  out.push("");
  for (const [g, list] of byGroup) {
    out.push(`## ${g}`);
    out.push("");
    for (const c of list) {
      const h = c.header;
      out.push(`### ${c.name}`);
      out.push("");
      out.push(h.summary);
      out.push("");
      out.push("| | |");
      out.push("|---|---|");
      out.push(`| Use | ${cell(h.use)} |`);
      out.push(`| Avoid | ${cell(h.avoid)} |`);
      out.push(`| Phone | ${cell(h.phone)} |`);
      out.push(`| Accessibility | ${cell(h.a11y)} |`);
      out.push(`| Status | ${h.status} |`);
      out.push(`| Exports | ${[c.name, ...h.exports].map((n) => `\`${n}\``).join(", ")} |`);
      out.push(`| Import | \`import { ${[c.name, ...h.exports].join(", ")} } from "@mycity/ui";\` |`);
      out.push(`| File | \`${c.rel}\` |`);
      out.push(`| Test | ${c.test ? `\`${c.test}\`` : "missing"} |`);
      out.push(`| Gallery | ${c.gallery ? `\`${c.gallery}\` (\`npm run gallery\`, \`#/${c.name}\`)` : "missing"} |`);
      out.push("");
      for (const { component, props } of c.props) {
        if (!props) {
          out.push(`**${component}** props: missing (no \`${component}Props\` in the file)`);
          out.push("");
          continue;
        }
        out.push(`**${component}** props (\`${props.name}\`${props.extends.length ? `, extends \`${props.extends.join("`, `")}\`` : ""})`);
        out.push("");
        if (!props.props.length) {
          out.push("No props of its own.");
          out.push("");
          continue;
        }
        out.push("| Prop | Type | Required | Description |");
        out.push("|---|---|---|---|");
        for (const p of props.props) out.push(`| \`${p.name}\` | \`${cell(p.type)}\` | ${p.required ? "yes" : ""} | ${cell(p.doc)} |`);
        out.push("");
      }
      if (h.example.length) {
        out.push("```tsx");
        for (const e of h.example) out.push(e);
        out.push("```");
        out.push("");
      }
    }
  }
  out.push("## Helpers");
  out.push("");
  out.push("Not components, but imported from `@mycity/ui` the same way (`packages/ui/src/lib`).");
  out.push("");
  out.push("| Export | File | What it does |");
  out.push("|---|---|---|");
  for (const h of helperList) out.push(`| \`${h.name}\`${h.kind === "type" ? " (type)" : ""} | \`lib/${h.file}\` | ${cell(h.doc)} |`);
  out.push("");
  return out.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const text = render(collect());
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (check) {
    if (current !== text) {
      console.error("components: docs/COMPONENTS.md is stale. Run `npm run gen:components` and commit it.");
      process.exit(1);
    }
    console.log("components: docs/COMPONENTS.md is current");
    return;
  }
  if (current === text) {
    console.log("docs/COMPONENTS.md unchanged");
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log("wrote docs/COMPONENTS.md");
}

module.exports = { collect, render, parseHeader, componentFiles, GROUPS, GROUP_DIRS, STATUSES, REQUIRED, ROOT, PKG, SRC, OUT };

if (require.main === module) main();
