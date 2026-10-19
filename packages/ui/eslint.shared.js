/**
 * The lint rules shared by @mycity/ui and both apps (FRONTEND_FOUNDATION F4, F7;
 * MILESTONES §3). Zero warnings everywhere, like the backend.
 *
 *   frontendConfig({ kind: "package" })                       packages/ui
 *   frontendConfig({ kind: "app" })                               app/, public-app/
 *
 * What a linter can check on its own:
 *   - no Zod: no `zod` import (nor a subpath such as `zod/v4`) and no `z.object(...)` outside @mycity/contract
 *     (the package may import Zod TYPES to type useContractForm)
 *   - gate 15: no <input type="date">, no toLocaleDateString() without a locale
 *   - gate 16: no window.alert / confirm / prompt
 *   - gate 18: no raw <input type="file"> outside packages/ui/src/form
 *   - icons: no <use href="#..."> sprite reference (there is no sprite; it draws
 *     blank and no type check sees it); <Icon name> instead
 *   - F7: Radix, Vaul, Sonner, Lucide and react-hook-form are imported only
 *     inside packages/ui; a feature composes the components built on them
 *   - F4, in the apps: no `style` prop, no hex colour, no arbitrary-value class
 *     (`w-[317px]`, `bg-[#fff]`, `[stroke-width:2]`); a token class or a
 *     component instead. Variants such as `data-[state=open]:` and values that
 *     only name a variable (`w-[var(--rail)]`, `duration-(--dur)`) are allowed.
 *   - F26, one press, one request: a button's handler hands back its work
 *     (onClick={save}, onClick={() => save()}) rather than throwing it away with
 *     `void`, because the button watches that promise to stay busy and refuse a
 *     second press. The same for Form onSubmit, Wizard onFinish, ConfirmDialog
 *     onConfirm and ExportButton onExport.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** Exported for scripts/check/palette.js (gate 13), so the gate and the linter read one pattern. */
export const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])/;
/** `w-[317px]`, `-mt-[3px]`, `text-[12.5px]`, `bg-[#fff]`, `[stroke-width:1.6]`; not `data-[state=open]:` or `w-[var(--x)]`. */
export const ARBITRARY = /(?:^|[\s"'`:!])(-?[a-z][a-z0-9-]*-\[(?!var\()[^\]\s]+\](?![\w:-])|\[[a-z][a-z-]*:[^\]\s]+\](?![\w:-]))/;

const attr = (node, name) => node.name && node.name.type === "JSXIdentifier" && node.name.name === name;
const attrValue = (node) => {
  const v = node.value;
  if (!v) return null;
  if (v.type === "Literal") return v.value;
  if (v.type === "JSXExpressionContainer" && v.expression.type === "Literal") return v.expression.value;
  return null;
};
/** Visit every string: plain literals and the static parts of template literals. */
const stringsOf = (check) => ({
  Literal(node) {
    if (typeof node.value === "string") check(node, node.value);
  },
  TemplateElement(node) {
    check(node, node.value.raw);
  },
});

function rule(description, create) {
  return { meta: { type: "problem", docs: { description }, schema: [] }, create };
}

/** F26: the components that watch the work a handler returns, and the prop each watches it on. */
export const PRESS_PROPS = {
  Button: "onClick",
  BigButton: "onClick",
  IconButton: "onClick",
  Form: "onSubmit",
  Wizard: "onFinish",
  ConfirmDialog: "onConfirm",
  ExportButton: "onExport",
};

const isFunction = (node) => !!node && /^(ArrowFunctionExpression|FunctionExpression|FunctionDeclaration)$/.test(node.type);
const isChain = (node) =>
  node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier" && ["then", "catch", "finally"].includes(node.callee.property.name);

/**
 * Where a function that is not async throws its work away: a `void`, or a
 * promise chain left as a statement (`save().then(close);`). An async function
 * hands back a promise of its own, so a `void` inside it is a side job, not the
 * work. A function nested inside is its own business.
 */
function droppedIn(fn, keys) {
  if (fn.async) return null;
  const stack = [fn.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    if (node.type === "UnaryExpression" && node.operator === "void") return node;
    if (node.type === "ExpressionStatement" && isChain(node.expression)) return node;
    if (node !== fn.body && isFunction(node)) continue;
    for (const key of keys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) stack.push(...child);
      else if (child) stack.push(child);
    }
  }
  return null;
}

/** The function a name stands for in this file: `function save() {}`, `const save = () => {}` or `const save = useCallback(() => {}, [])`. */
function localFunction(context, node, name) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (!variable) continue;
    const def = variable.defs[0];
    if (!def) return null;
    if (def.type === "FunctionName") return def.node;
    const init = def.type === "Variable" ? def.node.init : null;
    if (isFunction(init)) return init;
    if (init && init.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "useCallback" && isFunction(init.arguments[0])) {
      return init.arguments[0];
    }
    return null;
  }
  return null;
}

/**
 * The handler a press prop runs and where it drops its work, if it does: the
 * inline function itself, or the local function it names (onClick={save}) or
 * calls and hands back (onClick={() => save()}).
 */
function droppedWork(context, value) {
  const keys = context.sourceCode.visitorKeys;
  if (isFunction(value)) {
    const own = droppedIn(value, keys);
    if (own) return { node: own };
    const call = value.body.type === "CallExpression" && value.body.callee.type === "Identifier" ? value.body : null;
    const named = call && localFunction(context, value, call.callee.name);
    const inner = named && named !== value ? droppedIn(named, keys) : null;
    return inner ? { node: value, name: call.callee.name } : null;
  }
  if (value.type === "Identifier") {
    const named = localFunction(context, value, value.name);
    return named && droppedIn(named, keys) ? { node: value, name: value.name } : null;
  }
  return null;
}

/** The rules behind the gates, as a local plugin so each can be scoped to its own files. */
export const plugin = {
  meta: { name: "mycity" },
  rules: {
    "no-date-input": rule("gate 15: no native date input", (context) => ({
      JSXAttribute(node) {
        if (attr(node, "type") && attrValue(node) === "date") {
          context.report({ node, message: 'No <input type="date"> (gate 15). Use DateField from @mycity/ui, which is day-first.' });
        }
      },
    })),
    "no-file-input": rule("gate 18: no raw file input", (context) => ({
      JSXAttribute(node) {
        if (attr(node, "type") && attrValue(node) === "file") {
          context.report({ node, message: "No raw file input (gate 18). Use the upload field from @mycity/ui." });
        }
      },
    })),
    "no-bare-date-locale": rule("gate 15: toLocaleDateString needs a locale", (context) => ({
      CallExpression(node) {
        const c = node.callee;
        if (c.type === "MemberExpression" && c.property.type === "Identifier" && c.property.name === "toLocaleDateString" && node.arguments.length === 0) {
          context.report({ node, message: "toLocaleDateString() needs a locale (gate 15). Use the formats from @mycity/ui." });
        }
      },
    })),
    "no-z-object": rule("schemas live in @mycity/contract", (context) => ({
      CallExpression(node) {
        const c = node.callee;
        if (c.type === "MemberExpression" && c.object.type === "Identifier" && c.object.name === "z" && c.property.type === "Identifier" && c.property.name === "object") {
          context.report({ node, message: "No z.object() outside @mycity/contract: forms validate with the contract's own schemas." });
        }
      },
    })),
    "no-inline-style": rule("F4: no inline style in a feature", (context) => ({
      JSXAttribute(node) {
        if (attr(node, "style")) {
          context.report({ node, message: "No inline style (F4). Use token classes, or a component from @mycity/ui." });
        }
      },
    })),
    "no-hex": rule("gate 13: colours come from tokens", (context) =>
      stringsOf((node, text) => {
        const m = HEX.exec(text);
        if (m) context.report({ node, message: `Raw colour "${m[0]}" (gate 13). Colours live in tokens.css; use a token class.` });
      }),
    ),
    "no-void-press": rule("F26: a press handler hands back its work", (context) => ({
      JSXAttribute(node) {
        const element = node.parent;
        const name = element.name && element.name.type === "JSXIdentifier" ? element.name.name : null;
        if (!name || !attr(node, PRESS_PROPS[name])) return;
        const value = node.value && node.value.type === "JSXExpressionContainer" ? node.value.expression : null;
        const found = value && droppedWork(context, value);
        if (!found) return;
        const prop = PRESS_PROPS[name];
        const where = found.name ? `${found.name}() throws its work away (a \`void\` or a loose .then chain)` : "the handler throws its work away";
        context.report({
          node: found.node,
          message: `${name} watches the work ${prop} hands back, to stay busy and refuse a second press (F26), but ${where}. Return the promise (${prop}={save}, ${prop}={() => save()}, or make the function async and await it).`,
        });
      },
    })),
    "no-arbitrary-class": rule("F4: no arbitrary Tailwind values", (context) =>
      stringsOf((node, text) => {
        const m = ARBITRARY.exec(text);
        if (m) context.report({ node, message: `Arbitrary value "${m[1]}" (F4). Use the token scale (text-sm, h-control, gap-3) or a component from @mycity/ui.` });
      }),
    ),
  },
};

const DIALOG_MESSAGE = "No native dialogs (gate 16). Use useConfirm, the modal or a toast from @mycity/ui.";
const ZOD_MESSAGE = "No Zod outside @mycity/contract: forms validate with the contract's own schemas.";
const ZOD = { name: "zod", message: ZOD_MESSAGE };
/** Zod's subpaths ("zod/v4", "zod/v4/core", "zod/mini") are other builds of Zod: a second instance by another door. */
const ZOD_SUBPATHS = { group: ["zod/*"], message: `${ZOD_MESSAGE} Zod's subpaths are other builds of it, so they are refused too.` };
/**
 * Libraries only @mycity/ui may import (F7, F22). A feature composes the
 * component instead, so an upgrade is one package's work and the heavy parts
 * stay inside their own chunks.
 */
const UI_ONLY = ["@radix-ui/*", "vaul", "sonner", "lucide-react", "react-hook-form", "@hookform/*", "@tiptap/*", "leaflet"];

/**
 * @param {object} options
 * @param {"package" | "app"} options.kind
 * @param {string[]} [options.fileInputAllowed]  app files that may still hold a raw file input; empty since PR 3 moved the upload engine into packages/ui
 * @param {string[]} [options.ignores]
 */
export function frontendConfig({ kind, fileInputAllowed = [], ignores = [] }) {
  const app = kind === "app";
  const restricted = app
    ? {
        paths: [ZOD],
        patterns: [ZOD_SUBPATHS, { group: UI_ONLY, message: "Imported only inside @mycity/ui (F7). Use the component from @mycity/ui." }],
      }
    : { paths: [{ ...ZOD, allowTypeImports: true }], patterns: [{ ...ZOD_SUBPATHS, allowTypeImports: true }] };

  return tseslint.config(
    { ignores: ["dist", "dist-gallery", "dev-dist", "node_modules", ...ignores] },
    {
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      files: ["**/*.{ts,tsx}"],
      languageOptions: { ecmaVersion: 2022, globals: globals.browser },
      plugins: { "react-hooks": reactHooks, mycity: plugin },
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": ["error", restricted],
        "no-restricted-globals": ["error", ...["alert", "confirm", "prompt"].map((name) => ({ name, message: DIALOG_MESSAGE }))],
        "no-restricted-properties": ["error", ...["alert", "confirm", "prompt"].map((property) => ({ object: "window", property, message: DIALOG_MESSAGE }))],
        "mycity/no-date-input": "error",
        "mycity/no-bare-date-locale": "error",
        "mycity/no-z-object": "error",
        "mycity/no-void-press": "error",
        "no-restricted-syntax": [
          "error",
          {
            selector: "JSXOpeningElement[name.name='use']",
            message: "No <use href> sprite references: there is no sprite, so the icon draws blank. Use <Icon name> from @mycity/ui.",
          },
        ],
      },
    },
    {
      // Source only: build config (the PWA manifest) may name a colour.
      files: app ? ["src/**/*.{ts,tsx}"] : ["src/**/*.{ts,tsx}", "gallery/**/*.{ts,tsx}"],
      rules: { "mycity/no-hex": "error" },
    },
    {
      files: ["**/*.tsx"],
      ignores: app ? fileInputAllowed : ["src/form/**"],
      rules: { "mycity/no-file-input": "error" },
    },
    app
      ? {
          files: ["src/**/*.{ts,tsx}"],
          rules: { "mycity/no-inline-style": "error", "mycity/no-arbitrary-class": "error" },
        }
      : {
          files: ["src/**/*.{ts,tsx}", "gallery/**/*.{ts,tsx}"],
          rules: { "mycity/no-arbitrary-class": "error" },
        },
  );
}

export default frontendConfig;
