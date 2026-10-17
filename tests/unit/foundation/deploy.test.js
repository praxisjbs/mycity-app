"use strict";
/**
 * The release pipeline's pure parts: the release manifest, verify-staging's judgement, and
 * deploy-gate's refusals (which key may run what, and every promote check that runs before
 * anything is touched). The full stage, seal, promote and rollback round trip needs a server
 * layout, Postgres and running services; docs/runbooks/deploy.md says how it was exercised.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const manifest = require("../../../scripts/deploy/release-manifest");
const staging = require("../../../scripts/deploy/verify-staging");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const GATE = path.join(ROOT, "scripts", "deploy", "deploy-gate");
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function put(root, rel, text = "x") {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

describe("release manifest", () => {
  function fakeRepo() {
    const root = tmp("mycity-repo-");
    for (const f of manifest.FILES) {
      if (/\.(json|nvmrc)$|^\.nvmrc$/.test(f.path)) put(root, f.path, "{}\n");
      else put(root, `${f.path}/index.js`, "module.exports = 1;\n");
    }
    put(root, "src/app.test.js", "test");
    put(root, "src/.env", "SECRET=1");
    put(root, "packages/contract/node_modules/zod/index.js", "x");
    put(root, "docs/not-shipped.md", "x");
    return root;
  }

  test("ships the runtime, never tests, .env files, node_modules or docs", () => {
    const files = manifest.releaseFiles(fakeRepo());
    expect(files).toContain("src/index.js");
    expect(files).toContain("app/dist/index.js");
    expect(files.some((f) => /test\.js$|\.env$|node_modules|^docs\//.test(f))).toBe(false);
  });

  test("a missing frontend build is an error that says how to build it", () => {
    const root = fakeRepo();
    fs.rmSync(path.join(root, "app", "dist"), { recursive: true });
    expect(() => manifest.releaseFiles(root)).toThrow(/app\/dist is missing: build the app first/);
  });

  test("RELEASE, BUILD.env and SHA256SUMS; check() finds a changed, missing or extra file", () => {
    const root = fakeRepo();
    const stage = tmp("mycity-stage-");
    expect(() => manifest.assemble({ root, stage, sha: "abc" })).toThrow(/40-character/);
    const { release } = manifest.assemble({ root, stage, sha: SHA, run: 7, builtAt: new Date("2026-10-15T10:00:00.123Z") });
    expect(release).toMatchObject({ sha: SHA, run: "7", built_at: "2026-10-15T10:00:00Z" });
    expect(fs.readFileSync(path.join(stage, "BUILD.env"), "utf8")).toBe(`BUILD_SHA=${SHA}\nBUILD_TIME=2026-10-15T10:00:00Z\n`);
    expect(fs.readFileSync(path.join(stage, "SHA256SUMS"), "utf8")).toMatch(/ {2}BUILD\.env\n[\s\S]* {2}RELEASE\n/);
    expect(manifest.check(stage)).toEqual([]);
    put(stage, "node_modules/zod/index.js", "installed on the server");
    put(stage, "STAGING_VERIFIED", "sha=...");
    expect(manifest.check(stage)).toEqual([]);
    put(stage, "src/index.js", "changed");
    fs.rmSync(path.join(stage, "templates", "index.js"));
    put(stage, "src/extra.js", "x");
    expect(manifest.check(stage)).toEqual(["src/index.js: changed", "templates/index.js: missing", "src/extra.js: not in the release"]);
  });
});

describe("verify-staging", () => {
  test("the expected head is the newest migration or reference seed, as the ledger records them", () => {
    const root = path.resolve(__dirname, "..", "..", "..");
    const names = ["migrations", "seeds/reference"].flatMap((d) =>
      fs.readdirSync(path.join(root, d)).filter((f) => /^\d+_.*\.sql$/.test(f)).map((f) => f.replace(/\.sql$/, "")),
    );
    const newest = names.sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0])).pop();
    expect(staging.expectedHead()).toBe(newest);
  });

  const head = "0099_seed_reference";
  const answer = (status, json, headers = {}, text = "") => ({
    status,
    json,
    text: text || (json ? JSON.stringify(json) : ""),
    headers: new Headers({ "x-mycity-environment": "staging", "x-robots-tag": "noindex, nofollow", ...headers }),
  });
  const ready = (over = {}) =>
    answer(200, {
      ok: true,
      status: "degraded",
      build: { sha: SHA, env: "staging" },
      checks: {
        postgres: { status: "up" },
        modules: { status: "up", mounted: 9, skipped: [] },
        migrations: { status: "up", head },
        static: { status: "up", staff: true, public: true },
        clamd: { status: "degraded", error: "no socket" },
      },
      ...over,
    }, { "strict-transport-security": "max-age=31536000" });
  function fakeFetch(overrides = {}) {
    const routes = {
      "https://hub.test/api/health/ready": ready(),
      "https://hub.test/people/employees": answer(200, null, { "content-type": "text/html", "cache-control": "no-cache" }, '<script src="/assets/index-AB12.js">'),
      "https://hub.test/assets/index-AB12.js": answer(200, null, { "cache-control": "public, max-age=31536000, immutable" }),
      "https://hub.test/api/public/v1/jobs": answer(404, { code: "NOT_FOUND" }),
      "https://go.test/api/v1/auth/me": answer(404, { code: "NOT_FOUND" }),
      "https://go.test/socket.io/": answer(404, { code: "NOT_FOUND" }),
      "https://go.test/": answer(200, null, { "content-type": "text/html" }),
      "http://hub.test/api/health": answer(301, null, { location: "https://hub.test/api/health" }),
      "https://hub.test/api/v1/auth/me": (o) =>
        o.headers?.authorization === "Bearer qa-token"
          ? answer(200, { email: "QA@mycityapp.io" })
          : answer(401, { error: { code: "AUTH_REQUIRED" } }),
      "https://hub.test/api/v1/auth/login": (o) =>
        o.body.email === QA.email && o.body.password === QA.password
          ? answer(200, { access_token: "qa-token" })
          : answer(401, { error: { code: "INVALID_CREDENTIALS" } }),
      "https://hub.test/api/v1/settings/approvals": answer(403, { error: { code: "FORBIDDEN" } }),
      "https://hub.test/api/v1/auth/logout": answer(204, null),
      ...overrides,
    };
    return async (url, opts = {}) => {
      if (!routes[url]) throw new Error(`unexpected ${url}`);
      return typeof routes[url] === "function" ? routes[url](opts) : routes[url];
    };
  }
  const QA = { email: "qa@mycityapp.io", password: "Qa-login-pw-9!" };
  const run = (fetchImpl, qa = null) =>
    staging.verify({ sha: SHA, hub: "https://hub.test", go: "https://go.test", head, qa, fetchImpl });

  test("a healthy staging passes; a degraded tool is a warning, not a failure", async () => {
    const r = await run(fakeFetch());
    expect(r.failed).toEqual([]);
    expect(r.warnings).toEqual(["clamd is degraded (no socket)"]);
    expect(r.passed.length).toBeGreaterThan(12);
  });

  test("another build, a skipped module, migrations behind, a leaking host: each fails", async () => {
    const r = await run(fakeFetch({
      "https://hub.test/api/health/ready": ready({
        build: { sha: OTHER, env: "staging" },
        checks: { modules: { status: "degraded", mounted: 8, skipped: ["leave"] }, migrations: { status: "up", head: "0098_x" }, static: { staff: true, public: false } },
      }),
      "https://go.test/api/v1/auth/me": answer(401, { code: "UNAUTHENTICATED" }),
    }));
    expect(r.failed.join("\n")).toMatch(/build: staging runs bbbbbbbbbbbb, expected aaaaaaaaaaaa/);
    expect(r.failed.join("\n")).toMatch(/modules: skipped: leave/);
    expect(r.failed.join("\n")).toMatch(/migrations at head: database 0098_x, repository 0099_seed_reference/);
    expect(r.failed.join("\n")).toMatch(/frontend builds present/);
    expect(r.failed.join("\n")).toMatch(/go refuses the staff API: HTTP 401/);
  });

  test("without the QA login, sign-in and RBAC are pending; the wrong-password probe still runs", async () => {
    const r = await run(fakeFetch());
    expect(r.passed).toEqual(expect.arrayContaining(["staff API needs a session: HTTP 401", "sign-in refuses a wrong password: HTTP 401 INVALID_CREDENTIALS"]));
    expect(r.pending.map(([what]) => what)).toEqual(expect.arrayContaining(["sign-in round trip", "RBAC deny check", "PDF render"]));
  });

  test("with the QA login: sign in, own account, sign out, and a Staff session refused Settings", async () => {
    const r = await run(fakeFetch(), QA);
    expect(r.failed).toEqual([]);
    expect(r.passed).toEqual(expect.arrayContaining([
      "sign-in round trip: sign in 200, own account 200, sign out 204",
      "RBAC deny check: a Staff session asking for Settings, Approvals: HTTP 403",
    ]));
    expect(r.pending.map(([what]) => what)).not.toContain("sign-in round trip");
  });

  test("a sign-in that errors, a QA login with two-step, or a grant that leaks: each fails", async () => {
    let r = await run(fakeFetch({ "https://hub.test/api/v1/auth/login": answer(500, { error: { code: "INTERNAL" } }) }));
    expect(r.failed.join("\n")).toMatch(/sign-in refuses a wrong password: HTTP 500 INTERNAL/);

    r = await run(fakeFetch({
      "https://hub.test/api/v1/auth/login": (o) =>
        o.body.email === QA.email ? answer(200, { step: "code", challenge_token: "t", expires_in: 300 }) : answer(401, { error: { code: "INVALID_CREDENTIALS" } }),
    }), QA);
    expect(r.failed).toEqual([
      "sign-in round trip: the QA login asks for a code; turn two-step off for it",
      "RBAC deny check: no session to check with",
    ]);

    r = await run(fakeFetch({ "https://hub.test/api/v1/settings/approvals": answer(200, { data: [] }) }), QA);
    expect(r.failed).toEqual(["RBAC deny check: a Staff session asking for Settings, Approvals: HTTP 200"]);
  });

  test("the QA login comes from the environment, both values or neither", () => {
    expect(staging.qaFromEnv({})).toBeNull();
    expect(staging.qaFromEnv({ STAGING_QA_EMAIL: "qa@x.io", STAGING_QA_PASSWORD: "p" })).toEqual({ email: "qa@x.io", password: "p" });
    expect(() => staging.qaFromEnv({ STAGING_QA_EMAIL: "qa@x.io" })).toThrow(/both/);
  });

  test("an unreachable staging fails at once", async () => {
    const r = await run(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    expect(r.failed).toEqual(["readiness: https://hub.test did not answer (getaddrinfo ENOTFOUND)"]);
  });
});

const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
(hasBash ? describe : describe.skip)("deploy-gate refusals", () => {
  let root;
  let home;
  function gate(key, command, env = {}) {
    const r = spawnSync("bash", [GATE, ...(key ? [`--key=${key}`] : [])], {
      encoding: "utf8",
      input: "",
      env: { PATH: process.env.PATH, HOME: home, SSH_ORIGINAL_COMMAND: command, DG_ROOT: root, DG_HOME: home, DG_SUDO: "0", DG_TODAY: "0601", DG_READY_TIMEOUT: "1", ...env },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }
  function layout() {
    root = tmp("mycity-srv-");
    home = tmp("mycity-deploy-");
    for (const e of ["stg", "prod"]) fs.mkdirSync(path.join(root, e, "releases"), { recursive: true });
  }
  function sealed(sha, { verifiedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z"), sealSha = sha, tree } = {}) {
    const rel = path.join(root, "stg", "releases", sha);
    put(rel, "src/server.js", "1");
    fs.symlinkSync(rel, path.join(root, "stg", "current"));
    const hash = tree || spawnSync("bash", ["-c", `source <(sed -n '/^tree_hash()/,/^}/p' "${GATE}"); SEAL=STAGING_VERIFIED tree_hash "${rel}"`], { encoding: "utf8" }).stdout.trim();
    put(rel, "STAGING_VERIFIED", `sha=${sealSha}\ntree_sha256=${hash}\nverified_at=${verifiedAt}\nrun=1\n`);
    return rel;
  }
  beforeEach(layout);

  test("each key runs only its own commands, with well-formed arguments", () => {
    expect(gate(null, "status").out).toMatch(/no --key/);
    expect(gate("staging", `promote ${SHA} 1`).out).toMatch(/the staging key may not run 'promote/);
    expect(gate("production", `stage ${SHA}`).out).toMatch(/the production key may not run 'stage/);
    expect(gate("production", `rollback staging ${SHA}`).out).toMatch(/usage: rollback production <sha>/);
    expect(gate("staging", "stage abc").out).toMatch(/usage: stage <40-character sha>/);
    expect(gate("staging", `stage ${SHA}; rm -rf /`).out).toMatch(/usage: stage/);
    expect(gate("staging", `seal ${SHA} run-1`).out).toMatch(/usage: seal <sha> <run-id>/);
    expect(gate("staging", "bash").out).toMatch(/may not run 'bash'/);
    expect(gate("staging", "").out).toMatch(/may not run ''/);
    const s = gate("production", "status");
    expect(s.status).toBe(0);
    expect(s.out).toMatch(/stg\tcurrent=none/);
  });

  test("promote refuses before touching anything: unsealed, wrong seal, moved on, stale, changed, frozen", () => {
    expect(gate("production", `promote ${SHA} 9`).out).toMatch(/was never sealed on staging/);
    layout();
    sealed(SHA, { sealSha: OTHER });
    expect(gate("production", `promote ${SHA} 9`).out).toMatch(/the seal names another commit/);
    layout();
    const rel = sealed(SHA);
    fs.unlinkSync(path.join(root, "stg", "current"));
    fs.symlinkSync(path.join(root, "stg", "releases", OTHER), path.join(root, "stg", "current"));
    expect(gate("production", `promote ${SHA} 9`).out).toMatch(/staging has moved on to bbbbbbbbbbbb/);
    layout();
    sealed(SHA, { verifiedAt: "2026-01-01T00:00:00Z" });
    expect(gate("production", `promote ${SHA} 9`).out).toMatch(/the seal is \d+ days old \(limit 7\)/);
    layout();
    const rel2 = sealed(SHA);
    put(rel2, "src/server.js", "changed after the seal");
    expect(gate("production", `promote ${SHA} 9`).out).toMatch(/the staging tree changed after it was sealed/);
    layout();
    sealed(SHA);
    expect(gate("production", `promote ${SHA} 9`, { DG_TODAY: "1225" }).out).toMatch(/frozen from 21 December to 5 January/);
    expect(gate("production", `promote ${SHA} 9`, { DG_TODAY: "0103" }).out).toMatch(/frozen/);
    expect(fs.existsSync(path.join(root, "prod", "releases", SHA))).toBe(false);
    expect(rel).toBeTruthy();
  });

  test("rollback only to a release still on the server", () => {
    expect(gate("production", `rollback production ${SHA}`).out).toMatch(/is not on the server any more/);
  });
});
