"use strict";
/**
 * What this change touched, for the process gates (progress, guides,
 * readme-map). Works the same in GitHub Actions and on a laptop.
 *
 * The comparison base, first match wins:
 *   MYCITY_BASE                 explicit ref or sha (tests, unusual setups)
 *   pull_request event          origin/<base branch>   (merge-base with HEAD)
 *   push event                  the sha before the push
 *   locally                     merge-base of HEAD and origin/main (or main)
 *
 * Locally the working tree counts too: uncommitted and untracked files are
 * part of "the change", because the Claude Stop hook runs before anything is
 * committed. In CI only commits count.
 *
 * Exemptions are trailers, one per line, in the PR description or in any
 * commit message of the change:
 *   Progress-unchanged: <reason>
 *   Guide-unchanged: <reason>
 * A trailer with no reason does not count.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const IN_CI = process.env.GITHUB_ACTIONS === "true";
const ZERO_SHA = /^0+$/;

function git(args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`);
  }
  return r.stdout;
}

const refExists = (ref) =>
  git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    allowFail: true,
  }) !== null;

function githubEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

let cachedBase;
/** The sha the change is measured from, or null when there is nothing to compare (first commit). */
function base() {
  if (cachedBase !== undefined) return cachedBase;
  const pick = () => {
    if (process.env.MYCITY_BASE)
      return git(["rev-parse", process.env.MYCITY_BASE]).trim();
    const event = githubEvent();
    const name = process.env.GITHUB_EVENT_NAME;
    if (name === "pull_request" && process.env.GITHUB_BASE_REF) {
      const ref = `origin/${process.env.GITHUB_BASE_REF}`;
      return git(["merge-base", "HEAD", ref]).trim();
    }
    if (
      name === "push" &&
      event &&
      event.before &&
      !ZERO_SHA.test(event.before) &&
      refExists(event.before)
    ) {
      return event.before;
    }
    if (IN_CI)
      return refExists("HEAD~1") ? git(["rev-parse", "HEAD~1"]).trim() : null;
    for (const ref of ["origin/main", "main"]) {
      if (refExists(ref)) return git(["merge-base", "HEAD", ref]).trim();
    }
    return null;
  };
  cachedBase = pick();
  return cachedBase;
}

/**
 * Files the change touched: [{ path, status }] with status A, M, D or R (path is the new name).
 * Paths are repo-relative with forward slashes.
 */
function changedFiles() {
  const out = new Map();
  const add = (status, file) => {
    if (!file) return;
    // A file added by the change stays "A" when edited again afterwards; a later delete wins.
    if (out.get(file) === "A" && status !== "D") return;
    out.set(file, status);
  };
  const parse = (text) => {
    for (const line of (text || "").split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const code = parts[0][0];
      if (code === "R" || code === "C") add(code === "C" ? "A" : "R", parts[2]);
      else add(code, parts[1]);
    }
  };

  const b = base();
  if (b) parse(git(["diff", "--name-status", "-M", `${b}`, "HEAD"]));
  if (!IN_CI) {
    parse(git(["diff", "--name-status", "-M", "HEAD"], { allowFail: true }));
    for (const f of (
      git(["ls-files", "--others", "--exclude-standard"]) || ""
    ).split("\n"))
      add("A", f.trim());
  }
  return [...out.entries()].map(([file, status]) => ({ path: file, status }));
}

/**
 * Lines added to one file by the change (committed and, locally, uncommitted).
 * @param {string} file repo-relative path
 */
function addedLines(file) {
  const b = base();
  const tracked =
    git(["ls-files", "--error-unmatch", file], { allowFail: true }) !== null;
  if (!tracked || !b) {
    const full = path.join(ROOT, file);
    if (!tracked && fs.existsSync(full))
      return fs.readFileSync(full, "utf8").split(/\r?\n/);
    if (!b) return [];
  }
  const diff = IN_CI
    ? git(["diff", "-U0", b, "HEAD", "--", file])
    : git(["diff", "-U0", b, "--", file]);
  return (diff || "")
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/** All text a trailer may live in: the PR description and the change's commit messages. */
function changeText() {
  const parts = [];
  const event = githubEvent();
  if (event && event.pull_request && event.pull_request.body)
    parts.push(event.pull_request.body);
  if (process.env.MYCITY_PR_BODY) parts.push(process.env.MYCITY_PR_BODY);
  const b = base();
  if (b)
    parts.push(
      git(["log", "--format=%B", `${b}..HEAD`], { allowFail: true }) || "",
    );
  return parts.join("\n");
}

/**
 * The reason given for a trailer, or null.
 * @param {string} name e.g. "Progress-unchanged"
 */
function trailer(name) {
  const re = new RegExp(`^\\s*${name}:[ \\t]*(\\S.*)$`, "im");
  const m = changeText().match(re);
  return m ? m[1].trim() : null;
}

/** Day-first date that is a real calendar day: 13/10/2026. */
function isDayFirstDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return false;
  const [, dd, mm, yyyy] = m.map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    d.getUTCFullYear() === yyyy &&
    d.getUTCMonth() === mm - 1 &&
    d.getUTCDate() === dd
  );
}

/** Repo-relative, forward slashes. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

module.exports = {
  ROOT,
  IN_CI,
  git,
  base,
  changedFiles,
  addedLines,
  trailer,
  isDayFirstDate,
  rel,
};
