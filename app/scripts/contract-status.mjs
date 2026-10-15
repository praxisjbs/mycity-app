#!/usr/bin/env node
/**
 * Which frontend modules still run on INTERIM types, and which are on the real contract.
 *
 * The frontend is typed against `Endpoints` in packages/contract/contract.gen.ts
 * (BACKEND_STRUCTURE §6.3). Until a module's schemas land, its screens use an
 * INTERIM file instead: app/src/api/types/<module>.ts, public-app/src/api/types/public.ts.
 * This report compares, for each INTERIM file, the endpoints the frontend calls
 * with the ones the generated contract declares, so it shows:
 *
 *   Interim           none of the module's endpoints are in the contract yet
 *   Partly            some are; the rest are still the frontend's proposal
 *   Ready to switch   every endpoint is in the contract: point the module's imports
 *                     at contract.gen.ts, delete the INTERIM file, fix what TypeScript flags
 *
 * A module whose INTERIM file has been deleted is on the contract and drops off the list.
 *
 * An endpoint the contract has under the same path but the frontend does not
 * call is listed too: it is often a rename, and the screen will need to follow.
 *
 * A report, not a gate: it always exits 0, unless --strict is given, which exits 1
 * while any module is Ready to switch and still on its INTERIM file.
 *
 * Usage (from app/):  npm run contract:status            the table
 *                     npm run contract:status -- --all   every endpoint, matched or not
 *                     npm run contract:status -- --json  for a script
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const GEN = join(ROOT, "packages", "contract", "contract.gen.ts");

/** Endpoint keys ("GET /api/v1/employees/:id") declared in a block of TypeScript. */
const KEY = /"((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^"]+)"\s*:/g;
const keysIn = (text) => [...text.matchAll(KEY)].map((m) => m[1]);
/** Path params are named differently on each side (":id", ":employee_id"); compare shapes, not names. */
const shape = (key) => key.replace(/:[a-z_]+/g, ":");

function contractKeys() {
  if (!existsSync(GEN)) return { keys: [], state: "missing" };
  const text = readFileSync(GEN, "utf8");
  const i = text.indexOf("interface Endpoints");
  if (i < 0) return { keys: [], state: text.trim() ? "no Endpoints" : "empty" };
  const keys = keysIn(text.slice(i));
  return { keys, state: keys.length ? "ok" : "empty" };
}

/** The INTERIM files, and the modules whose file has already been removed. */
function interimFiles() {
  const out = [];
  const add = (app, dir, skip) => {
    const abs = join(ROOT, app, dir);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs).sort()) {
      if (!f.endsWith(".ts") || skip.includes(f)) continue;
      const file = join(abs, f);
      const keys = keysIn(readFileSync(file, "utf8"));
      if (keys.length) out.push({ app, module: f.replace(/\.ts$/, ""), file: relative(ROOT, file), keys });
    }
  };
  add("app", "src/api/types", ["common.ts"]);
  add("public-app", "src/api/types", ["common.ts"]);
  return out;
}

/** The resource an endpoint belongs to: "/api/v1/settings", "/api/public/v1/jobs". */
const resource = (key) => {
  const parts = key.split(" ")[1].split("/").filter(Boolean);
  return "/" + parts.slice(0, parts[1] === "public" ? 4 : 3).join("/");
};

const contract = contractKeys();
const inContract = new Set(contract.keys.map(shape));
const interim = interimFiles();
const used = new Set(interim.flatMap((m) => m.keys.map(shape)));

const rows = interim.map((m) => {
  const matched = m.keys.filter((k) => inContract.has(shape(k)));
  const missing = m.keys.filter((k) => !inContract.has(shape(k)));
  const roots = new Set(m.keys.map(resource));
  const contractOnly = contract.keys.filter((k) => roots.has(resource(k)) && !used.has(shape(k)));
  const status = matched.length === 0 ? "Interim" : missing.length ? "Partly" : "Ready to switch";
  return { app: m.app, module: m.module, file: m.file, endpoints: m.keys.length, in_contract: matched.length, status, missing, matched, contract_only: contractOnly };
});

if (args.has("--json")) {
  console.log(JSON.stringify({ contract: { file: relative(ROOT, GEN), state: contract.state, endpoints: contract.keys.length }, modules: rows }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const STATE = { ok: `${contract.keys.length} endpoints`, missing: "not generated yet", empty: "empty: no routes generated yet", "no Endpoints": "has no Endpoints interface yet" };
  console.log(`Contract: ${relative(ROOT, GEN)} · ${STATE[contract.state]}`);
  console.log("");
  console.log(`${pad("App", 11)}${pad("Module", 15)}${pad("In contract", 13)}${pad("Status", 17)}Contract only`);
  for (const r of rows) {
    console.log(`${pad(r.app, 11)}${pad(r.module, 15)}${pad(`${r.in_contract} of ${r.endpoints}`, 13)}${pad(r.status, 17)}${r.contract_only.length || ""}`);
    if (args.has("--all")) {
      for (const k of r.matched) console.log(`    in contract    ${k}`);
      for (const k of r.missing) console.log(`    INTERIM only   ${k}`);
      for (const k of r.contract_only) console.log(`    contract only  ${k}   (not called by the frontend: a rename?)`);
    }
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  const total = rows.reduce((a, r) => a + r.endpoints, 0);
  const done = rows.reduce((a, r) => a + r.in_contract, 0);
  console.log("");
  console.log(`${rows.length} INTERIM files · ${count("Interim")} interim · ${count("Partly")} partly · ${count("Ready to switch")} ready to switch`);
  console.log(`${done} of ${total} frontend endpoints are in the contract.`);
  if (count("Ready to switch")) console.log("Ready to switch: point the module at contract.gen.ts, delete its INTERIM file, then run npm run typecheck.");
}

if (args.has("--strict") && rows.some((r) => r.status === "Ready to switch")) process.exit(1);
