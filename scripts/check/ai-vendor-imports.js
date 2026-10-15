#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: every AI call goes through services/ai/llm.service.js
 * (BACKEND_STRUCTURE §14.1). That is where the switch, the cap, redaction, the prompt
 * files and the ledger are; a call that goes round it is unmetered, unredacted and
 * invisible on the spend screen.
 *
 * Fails the build on:
 *  1. an AI vendor SDK in package.json, or imported anywhere in src/, scripts/ or
 *     packages/ (the vendors are called over HTTPS from services/ai/vendors/, no SDK);
 *  2. a vendor API host (Gemini, OpenAI, Anthropic, Groq, DeepSeek, Mistral, Vertex)
 *     in code outside src/services/ai/vendors/;
 *  3. a vendor file (services/ai/vendors/*) required from outside src/services/ai/.
 * Comments are not code: a comment that names a host passes.
 *
 * Usage: node scripts/check/ai-vendor-imports.js     exit 0 clean, 1 on a violation
 */
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./ai-no-writes");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN = ["src", "scripts", "packages"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);
const SELF = path.join("scripts", "check", "ai-vendor-imports.js");
const VENDOR_DIR = path.join("src", "services", "ai", "vendors") + path.sep;
const AI_DIR = path.join("src", "services", "ai") + path.sep;

const SDKS = [
  "openai",
  "@google/genai",
  "@google/generative-ai",
  "@google-cloud/vertexai",
  "@google-cloud/aiplatform",
  "@anthropic-ai/sdk",
  "groq-sdk",
  "cohere-ai",
  "@mistralai/mistralai",
  "replicate",
  "ai",
  "langchain",
  "llamaindex",
];
const SDK_PREFIXES = [
  "@langchain/",
  "@ai-sdk/",
  "@anthropic-ai/",
  "@google/genai/",
  "openai/",
];
const HOSTS =
  /\b(generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.groq\.com|api\.deepseek\.com|api\.mistral\.ai)\b/;
const IMPORT =
  /\b(?:require\s*\(\s*|import\s*\(\s*|from\s+)["'`]([^"'`]+)["'`]/g;

const isSdk = (spec) =>
  SDKS.includes(spec) || SDK_PREFIXES.some((p) => spec.startsWith(p));

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(c|m)?(j|t)sx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * @param {{root?: string}} [opts]
 * @returns {string[]} problems
 */
function check({ root = ROOT } = {}) {
  const problems = [];
  const pkgFile = path.join(root, "package.json");
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    for (const k of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const name of Object.keys(pkg[k] || {}))
        if (isSdk(name))
          problems.push(
            `package.json: ${name} is an AI vendor SDK; vendors are called over HTTPS from src/services/ai/vendors/`,
          );
    }
  }
  for (const file of SCAN.flatMap((d) => walk(path.join(root, d), []))) {
    const rel = path.relative(root, file);
    if (rel === SELF) continue;
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const shown = rel.split(path.sep).join("/");
    for (const m of code.matchAll(IMPORT)) {
      const spec = m[1];
      if (isSdk(spec))
        problems.push(
          `${shown}: imports ${spec}, an AI vendor SDK. Call services/ai/llm.service instead`,
        );
      if (/services\/ai\/vendors\//.test(spec) && !rel.startsWith(AI_DIR)) {
        problems.push(
          `${shown}: requires a vendor file directly (${spec}). Call services/ai/llm.service instead`,
        );
      }
    }
    if (!rel.startsWith(VENDOR_DIR)) {
      const h = HOSTS.exec(code);
      if (h)
        problems.push(
          `${shown}: calls ${h[1]} directly. Every AI call goes through services/ai/llm.service`,
        );
    }
  }
  return problems;
}

if (require.main === module) {
  const problems = check();
  if (problems.length === 0) {
    console.log(
      "ai-vendor-imports: ok (no vendor SDK, no direct vendor calls outside services/ai/vendors)",
    );
    process.exit(0);
  }
  console.error(
    "ai-vendor-imports: AI is called only through services/ai/llm.service (BACKEND_STRUCTURE §14.1)\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, isSdk };
