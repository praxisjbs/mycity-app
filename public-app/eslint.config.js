/**
 * Lint for the public site, the same gates as the staff app. Zero warnings, like the backend.
 *
 * Beyond the recommended sets, the rules here are the frontend gates that a
 * linter can check on its own (MILESTONES §3):
 *   - no Zod in the app: forms validate with the contract's own schemas
 *   - gate 15: no <input type="date">, no toLocaleDateString() without a locale
 *   - gate 16: no window.alert / confirm / prompt
 *   - gate 18: no raw <input type="file"> outside the upload component
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const DIALOGS = ["alert", "confirm", "prompt"].map((name) => ({
  name,
  message: "No native dialogs (gate 16). Use the shared modal or a toast.",
}));

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-restricted-imports": ["error", { paths: [{ name: "zod", message: "The app declares no Zod of its own; use the contract." }] }],
      "no-restricted-globals": ["error", ...DIALOGS],
      "no-restricted-properties": [
        "error",
        ...["alert", "confirm", "prompt"].map((property) => ({
          object: "window",
          property,
          message: "No native dialogs (gate 16). Use the shared modal or a toast.",
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='type'][value.value='date']",
          message: "No <input type=\"date\"> (gate 15). Take dates as day-first text (lib/format parseDayFirst).",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString'][arguments.length=0]",
          message: "toLocaleDateString() needs a locale (gate 15). Use lib/format.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/Upload.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='type'][value.value='date']",
          message: "No <input type=\"date\"> (gate 15). Take dates as day-first text (lib/format parseDayFirst).",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString'][arguments.length=0]",
          message: "toLocaleDateString() needs a locale (gate 15). Use lib/format.",
        },
        {
          selector: "JSXAttribute[name.name='type'][value.value='file']",
          message: "No raw file input (gate 18). Use the Upload component.",
        },
      ],
    },
  },
);
