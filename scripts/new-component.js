#!/usr/bin/env node
"use strict";
/**
 * Add a shared component to packages/ui, the one way (FRONTEND_FOUNDATION F8, F11):
 *
 *   npm run new:component -- --name StatusPill --group Display [--dir display]
 *
 * Writes packages/ui/src/<dir>/<Name>.tsx with the header template, its
 * <Name>.test.tsx and <Name>.gallery.tsx, exports it from the group barrel
 * (<dir>/index.ts), and regenerates docs/COMPONENTS.md. The header's TODO lines
 * must be written before scripts/check/components.js passes.
 *
 * --dir defaults to the group's folder (Display: display, Overlays: overlay,
 * Forms: form, Foundations: icons, ...). A folder that is new gets its own
 * barrel, exported from src/index.ts.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { GROUPS, GROUP_DIRS, SRC, ROOT } = require("./gen/components");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

function fail(message) {
  console.error(`new:component: ${message}`);
  console.error("Usage: npm run new:component -- --name StatusPill --group Display [--dir display]");
  console.error(`Groups: ${GROUPS.join(", ")}`);
  process.exit(1);
}

const name = arg("name");
const group = arg("group");
if (!name || !/^[A-Z][A-Za-z0-9]+$/.test(name)) fail("--name must be PascalCase, like StatusPill");
if (!group || !GROUPS.includes(group)) fail(`--group must be one of the groups below, not "${group || ""}"`);
const dir = (arg("dir") || GROUP_DIRS[group]).replace(/^\/+|\/+$/g, "");
if (!/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/.test(dir) || dir === "testing" || dir === "lib" || dir === "styles") {
  fail(`--dir "${dir}" must be a lower-case folder under packages/ui/src (not testing, lib or styles)`);
}

const folder = path.join(SRC, dir);
const file = path.join(folder, `${name}.tsx`);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
if (fs.existsSync(file)) fail(`${rel(file)} already exists`);
for (const g of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (g.isDirectory() && fs.existsSync(path.join(SRC, g.name, `${name}.tsx`))) fail(`a ${name} already exists in packages/ui/src/${g.name}`);
}

const up = path.relative(folder, SRC).split(path.sep).join("/") || ".";
const lib = `${up}/lib/cn`;
const testing = `${up}/testing`;

const component = `/**
 * @component ${name}
 * @group ${group}
 * @summary TODO one sentence: what it is.
 * @use TODO when to use it.
 * @avoid TODO when not to, and what to use instead.
 * @phone TODO how it behaves at 760 px and below.
 * @a11y TODO what it guarantees, and what the caller must pass.
 * @status beta
 * @example <${name}>Leave Requests</${name}>
 */
import type { ReactNode } from "react";
import { cn } from "${lib}";

export interface ${name}Props {
  /** TODO what this prop is. */
  children?: ReactNode;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

export function ${name}({ children, className }: ${name}Props) {
  return <div className={cn(className)}>{children}</div>;
}
`;

const test = `import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "${testing}/axe";
import { ${name} } from "./${name}";

describe("${name}", () => {
  it("renders", () => {
    render(<${name}>Leave Requests</${name}>);
    expect(screen.getByText("Leave Requests")).toBeInTheDocument();
  });

  it.todo("behaves: keyboard, click, open and close, as it applies");

  it("has no accessibility violations", async () => {
    const { container } = render(<${name}>Leave Requests</${name}>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
`;

const gallery = `import type { GalleryEntry } from "${testing}/gallery";
import { ${name} } from "./${name}";

export default {
  component: "${name}",
  states: {
    Default: () => <${name}>Leave Requests</${name}>,
  },
} satisfies GalleryEntry;
`;

fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(file, component);
fs.writeFileSync(path.join(folder, `${name}.test.tsx`), test);
fs.writeFileSync(path.join(folder, `${name}.gallery.tsx`), gallery);

/** Add `export * from "./<file>"` to a barrel: sorted in a group barrel, appended in the package barrel. */
function addExport(barrel, target, title, sort = true) {
  const line = `export * from "./${target}";`;
  let text = fs.existsSync(barrel)
    ? fs.readFileSync(barrel, "utf8")
    : `/**\n * ${title}. Each component file in this folder is exported here (npm run new:component adds the line).\n */\n`;
  text = text.replace(/^export \{\};\n?/m, "");
  if (text.includes(line)) return false;
  const lines = text.split("\n");
  const exports = lines.filter((l) => /^export \* from /.test(l));
  const rest = lines.filter((l) => !/^export \* from /.test(l));
  while (rest.length && rest[rest.length - 1] === "") rest.pop();
  fs.writeFileSync(barrel, `${rest.join("\n")}\n${(sort ? [...exports, line].sort() : [...exports, line]).join("\n")}\n`);
  return true;
}

const top = dir.split("/")[0];
const groupBarrel = path.join(SRC, top, "index.ts");
const isNewTop = !fs.existsSync(groupBarrel);
const inner = dir.split("/").slice(1);
if (inner.length) {
  // A subfolder: its own barrel, exported from the group's.
  addExport(path.join(folder, "index.ts"), name, `The ${inner.join("/")} components`);
  addExport(groupBarrel, inner.join("/"), `The ${group} group`);
} else {
  addExport(groupBarrel, name, `The ${group} group`);
}
if (isNewTop) addExport(path.join(SRC, "index.ts"), top, "@mycity/ui", false);

const regen = spawnSync(process.execPath, [path.join(__dirname, "gen", "components.js")], { cwd: ROOT, encoding: "utf8" });
if (regen.status !== 0) {
  process.stderr.write(regen.stderr);
  fail("the catalogue did not regenerate; fix the error above and run npm run gen:components");
}

console.log(`Created ${name} (${group}):
  ${rel(file)}
  ${rel(path.join(folder, `${name}.test.tsx`))}
  ${rel(path.join(folder, `${name}.gallery.tsx`))}
  exported from ${rel(groupBarrel)}${isNewTop ? " (a new folder, also exported from packages/ui/src/index.ts)" : ""}
  docs/COMPONENTS.md regenerated

Next:
  1. Write the header in ${name}.tsx (every TODO), and a JSDoc line on each prop of ${name}Props.
  2. Build it on the tokens (styles/theme.css); no raw hex, no arbitrary values.
  3. Fill the gallery states (Title Case names, real MyCity wording) and the tests.
  4. npm -w @mycity/ui test   npm run gallery   npm run gen:components   node scripts/check/components.js`);
