#!/usr/bin/env node
"use strict";
/**
 * Assemble a release: the files the server runs, and the manifest deploy-gate checks them
 * against (SYSTEM_ARCHITECTURE §9.2 step 1).
 *
 *   node scripts/deploy/release-manifest.js --out=release.tgz --sha=<commit> [--run=<id>]
 *
 * Run by release.yml after `npm ci` and both frontend builds. Copies the paths in FILES into a
 * clean folder, then writes into it:
 *
 *   RELEASE      JSON: sha, built_at, run, node, lockfile sha256, file count
 *   BUILD.env    BUILD_SHA and BUILD_TIME, read by the systemd units, so /api/health/ready
 *                reports the build without anyone editing the server's .env
 *   SHA256SUMS   every file above and below, in `sha256sum -c` form
 *
 * and packs it as a gzip tarball. deploy-gate refuses a tarball whose RELEASE names another
 * commit or whose files do not match SHA256SUMS. node_modules is not shipped: the server runs
 * `npm ci --omit=dev` against the same lockfile, once, on staging; production gets that tree.
 *
 * `--check=<dir>` verifies an unpacked release the same way deploy-gate does, for a person
 * looking at one by hand.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

/** What a release contains. Paths that do not exist are an error, except where optional. */
const FILES = [
  { path: "package.json" },
  { path: "package-lock.json" },
  { path: ".nvmrc" },
  { path: "src" },
  { path: "packages/contract", skip: /node_modules/ },
  { path: "scripts/db" },
  { path: "scripts/import" },
  { path: "migrations" },
  { path: "seeds" },
  { path: "templates" },
  { path: "assets" },
  { path: "app/dist", built: true },
  { path: "public-app/dist", built: true },
];

/** Never shipped, wherever they sit. */
const NEVER = /(^|\/)(node_modules|\.env(\..*)?|.*\.test\.js|__tests__)(\/|$)/;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function walk(dir, rel, out) {
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (NEVER.test(r)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/**
 * The repository-relative files a release takes from `root`.
 * @param {string} root
 * @returns {string[]}
 */
function releaseFiles(root = ROOT) {
  const out = [];
  for (const f of FILES) {
    const full = path.join(root, f.path);
    if (!fs.existsSync(full)) {
      throw new Error(
        f.built
          ? `${f.path} is missing: build the app first (npm ci --prefix ... && npm run build --prefix ...)`
          : `${f.path} is missing from the checkout`,
      );
    }
    if (fs.statSync(full).isDirectory())
      walk(full, f.path, []).forEach((r) => {
        if (!f.skip || !f.skip.test(r)) out.push(r);
      });
    else out.push(f.path);
  }
  return [...new Set(out)].sort();
}

/**
 * `sha256sum` lines for files under `dir`, in the given order.
 * @param {string} dir
 * @param {string[]} files
 */
function sumsOf(dir, files) {
  return files
    .map((f) => `${sha256(fs.readFileSync(path.join(dir, f)))}  ${f}\n`)
    .join("");
}

/**
 * Copy the release into `stage` and write RELEASE, BUILD.env and SHA256SUMS.
 * @returns {{files: string[], release: object}}
 */
function assemble({
  root = ROOT,
  stage,
  sha,
  run = null,
  builtAt = new Date(),
}) {
  if (!/^[0-9a-f]{40}$/.test(String(sha || "")))
    throw new Error("--sha must be the full 40-character commit");
  const files = releaseFiles(root);
  for (const f of files) {
    const to = path.join(stage, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
  }
  const iso = builtAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const release = {
    sha,
    built_at: iso,
    run: run === null ? null : String(run),
    node: process.version,
    lockfile_sha256: sha256(
      fs.readFileSync(path.join(root, "package-lock.json")),
    ),
    files: files.length,
  };
  fs.writeFileSync(
    path.join(stage, "RELEASE"),
    `${JSON.stringify(release, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(stage, "BUILD.env"),
    `BUILD_SHA=${sha}\nBUILD_TIME=${iso}\n`,
  );
  const all = [...files, "RELEASE", "BUILD.env"].sort();
  fs.writeFileSync(path.join(stage, "SHA256SUMS"), sumsOf(stage, all));
  return { files: all, release };
}

/**
 * Check an unpacked release: every file in SHA256SUMS matches, and nothing else is there
 * except node_modules (installed on the server) and the staging seal.
 * @param {string} dir
 * @returns {string[]} problems
 */
function check(dir) {
  const problems = [];
  const sumsFile = path.join(dir, "SHA256SUMS");
  if (!fs.existsSync(sumsFile)) return ["no SHA256SUMS"];
  const listed = new Map();
  for (const line of fs
    .readFileSync(sumsFile, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) {
      problems.push(`SHA256SUMS: unreadable line "${line.slice(0, 60)}"`);
      continue;
    }
    listed.set(m[2], m[1]);
  }
  for (const [f, sum] of listed) {
    const full = path.join(dir, f);
    if (!fs.existsSync(full)) problems.push(`${f}: missing`);
    else if (sha256(fs.readFileSync(full)) !== sum)
      problems.push(`${f}: changed`);
  }
  const extra = walk(dir, "", []).filter(
    (f) => !listed.has(f) && f !== "SHA256SUMS" && f !== "STAGING_VERIFIED",
  );
  for (const f of extra) problems.push(`${f}: not in the release`);
  return problems;
}

function args(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) throw new Error(`Unknown argument "${a}"`);
    out[m[1]] = m[2];
  }
  return out;
}

function main(argv) {
  const a = args(argv);
  if (a.check) {
    const problems = check(path.resolve(a.check));
    for (const p of problems) console.error(`  - ${p}`);
    console.log(
      problems.length
        ? "release-manifest: the release does not match"
        : "release-manifest: ok",
    );
    return problems.length ? 1 : 0;
  }
  if (!a.out)
    throw new Error(
      "usage: --out=release.tgz --sha=<commit> [--run=<id>], or --check=<dir>",
    );
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-release-"));
  try {
    const { files, release } = assemble({
      stage,
      sha: a.sha,
      run: a.run ?? null,
    });
    const out = path.resolve(a.out);
    // Normal modes and no owner names, whatever the build machine had.
    const r = spawnSync(
      "tar",
      [
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--mode=u=rwX,go=rX",
        "-czf",
        out,
        "-C",
        stage,
        ".",
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("tar failed");
    console.log(
      `release-manifest: ${out} (${files.length} files, ${release.sha.slice(0, 12)}, lockfile ${release.lockfile_sha256.slice(0, 12)})`,
    );
    return 0;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`release-manifest: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { FILES, releaseFiles, assemble, check, sumsOf, main };
