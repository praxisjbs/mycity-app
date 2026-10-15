"use strict";
/**
 * Gate 1: lint, backend side. `npm run lint` = `eslint --max-warnings 0 .`
 *
 * Zero warnings from the first commit, so there is never a baseline to argue
 * down later. The frontend apps lint themselves with
 * their own configs, so they are ignored here.
 */
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "app/**",
      "public-app/**",
      "docs/**",
      ".claude/worktrees/**",
      "assets/**",
      "templates/**",
      "packages/contract/contract.gen.ts",
      "packages/ui/**",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // `_`-prefixed arguments are deliberately unused (Express signatures);
      // rest siblings drop a field on purpose: `({ _total, ...row }) => row`.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      "no-shadow": "error",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" },
  },
  {
    files: ["tests/**/*.js", "**/*.test.js"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
];
