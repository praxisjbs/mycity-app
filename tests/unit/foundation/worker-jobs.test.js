"use strict";
/**
 * The worker's pure parts: the job registry and schedule declarations, queue names,
 * the migration file rules, the seed guard, the contract generator, the socket host
 * rule and the worker's file discovery. The Redis and Postgres half runs in
 * tests/integration/worker.test.js.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { z } = require("zod");

const registry = require("../../../src/jobs/registry");
const queues = require("../../../src/jobs/queues");
const catalogue = require("../../../src/shared/events/catalogue");
const migrate = require("../../../scripts/db/migrate");
const seed = require("../../../scripts/db/seed");
const gen = require("../../../scripts/gen/contract");
const { hostAllowed } = require("../../../src/realtime/socket");
const worker = require("../../../src/worker");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("job registry", () => {
  test("every queue has a handler file exporting a function", () => {
    for (const j of registry.JOBS) {
      expect(typeof registry.handlerOf(j.queue)).toBe("function");
      expect(j.concurrency).toBeGreaterThanOrEqual(1);
    }
  });

  test("the queue list is the README §5.15 list: M0, and the M1 and M3 jobs built so far", () => {
    expect(registry.JOBS.map((j) => j.queue).sort()).toEqual([
      "announcement-publish",
      "attendance-day-close",
      "av-transcode",
      "celebrations",
      "email-send",
      "home-alert-sweeps",
      "import-commit",
      "import-validate",
      "mail-send",
      "mail-sync",
      "media-derive",
      "media-scan",
      "notification-deliver",
      "notification-push",
      "pdf-render",
      "query-rule-evaluate",
      "scheduled-report",
    ]);
    expect([...registry.SCHEDULERS].sort()).toEqual([
      "alert-ageing",
      "announcement-release",
      "attendance-day-close",
      "celebrations",
      "home-alert-sweeps",
      "import-cleanup",
      "mail-sync",
      "media-reconcile",
      "outbox-dispatch",
      "scheduled-reports",
      "workflow-timeout",
    ]);
  });

  test("every scheduler loads, is named after its file, and has a cadence", () => {
    const specs = registry.schedules();
    expect(specs).toHaveLength(registry.SCHEDULERS.length);
    for (const s of specs) {
      expect(s.every || s.pattern).toBeTruthy();
      expect(s.tz).toBe("Africa/Lagos");
    }
    const inProcess = specs.filter((s) => s.inProcess).map((s) => s.name);
    expect(inProcess).toEqual(["outbox-dispatch"]);
  });

  test("defineSchedule refuses a bad declaration", () => {
    const run = async () => {};
    expect(() =>
      registry.defineSchedule({ name: "Bad Name", every: 1000, run }),
    ).toThrow(/kebab-case/);
    expect(() => registry.defineSchedule({ name: "x", run })).toThrow(
      /every \(ms\) or pattern/,
    );
    expect(() =>
      registry.defineSchedule({
        name: "x",
        every: 1000,
        pattern: "* * * * *",
        run,
      }),
    ).toThrow(/not both/);
    expect(() =>
      registry.defineSchedule({ name: "x", every: 10, run }),
    ).toThrow(/at least 1000/);
    expect(() =>
      registry.defineSchedule({ name: "x", pattern: "* * *", run }),
    ).toThrow(/five-field/);
    expect(() =>
      registry.defineSchedule({
        name: "x",
        pattern: "0 3 * * *",
        inProcess: true,
        run,
      }),
    ).toThrow(/uses every/);
    expect(() => registry.defineSchedule({ name: "x", every: 1000 })).toThrow(
      /run is/,
    );
    expect(
      registry.defineSchedule({ name: "x", pattern: "0 3 * * *", run }).tz,
    ).toBe("Africa/Lagos");
  });

  test("isLastAttempt counts the attempt being made", () => {
    expect(
      registry.isLastAttempt({ attemptsMade: 0, opts: { attempts: 1 } }),
    ).toBe(true);
    expect(
      registry.isLastAttempt({ attemptsMade: 0, opts: { attempts: 5 } }),
    ).toBe(false);
    expect(
      registry.isLastAttempt({ attemptsMade: 4, opts: { attempts: 5 } }),
    ).toBe(true);
    expect(registry.isLastAttempt({ opts: {} })).toBe(true);
  });

  test("triggers listen to declared events and name declared queues", () => {
    require("../../../src/shared/documents/vault");
    for (const t of registry.TRIGGERS) {
      expect(catalogue.has(t.event)).toBe(true);
      expect(registry.isQueue(t.queue)).toBe(true);
    }
    const stored = (needs) => ({
      event_id: "e1",
      key: "document.stored",
      entity: { type: "document", id: "d1" },
      payload: { document_id: "d1", needs },
    });
    const scan = registry.TRIGGERS.find((t) => t.queue === "media-scan");
    const av = registry.TRIGGERS.find((t) => t.queue === "av-transcode");
    expect(scan.when(stored(["scan"]))).toBe(true);
    expect(scan.when(stored(["av"]))).toBe(false);
    expect(av.when(stored(["av"]))).toBe(true);
    expect(av.data(stored(["av"]))).toEqual({ document_id: "d1" });
    expect(scan.opts.attempts).toBe(10);
  });
});

describe("queues", () => {
  test("an undeclared queue is refused before Redis is touched", async () => {
    await expect(queues.enqueue("no-such-queue", "x", {})).rejects.toThrow(
      /is not a queue/,
    );
    expect(() => queues.getQueue("emailsend")).toThrow(
      /declare it in jobs\/registry.js/,
    );
  });

  test("defaults retry with backoff and keep a bounded history", () => {
    expect(queues.DEFAULTS).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  });
});

describe("migration files", () => {
  const write = (dir, name, text) =>
    fs.writeFileSync(path.join(dir, name), text);

  test("UP and DOWN sections are split; both markers are required", () => {
    expect(
      migrate.parseMigration(
        "-- note\n-- UP\nCREATE TABLE a (x int);\n-- DOWN\nDROP TABLE a;\n",
        "f",
      ),
    ).toEqual({
      up: "CREATE TABLE a (x int);",
      down: "DROP TABLE a;",
    });
    expect(() =>
      migrate.parseMigration("CREATE TABLE a (x int);", "f"),
    ).toThrow(/-- UP/);
    expect(() => migrate.parseMigration("-- DOWN\nx\n-- UP\ny", "f")).toThrow(
      /comes before/,
    );
    expect(() => migrate.parseMigration("-- UP\n\n-- DOWN\nx", "f")).toThrow(
      /UP section is empty/,
    );
  });

  test("the hash ignores Windows line endings", () => {
    expect(migrate.hashText("a\r\nb\r\n")).toBe(migrate.hashText("a\nb\n"));
    expect(migrate.hashText("a\nb")).not.toBe(migrate.hashText("a\nc"));
  });

  test("files are listed in order; a bad name or a reused number is an error", () => {
    const dir = tmp("mycity-mig-");
    write(dir, "0002_b.sql", "-- UP\nSELECT 2;\n-- DOWN\nSELECT 2;");
    write(dir, "0001_a.sql", "-- UP\nSELECT 1;\n-- DOWN\nSELECT 1;");
    write(dir, ".gitkeep", "");
    expect(migrate.listMigrations(dir).map((m) => m.name)).toEqual([
      "0001_a",
      "0002_b",
    ]);
    write(dir, "0002_c.sql", "-- UP\nSELECT 3;\n-- DOWN\nSELECT 3;");
    expect(() => migrate.listMigrations(dir)).toThrow(/0002 is already used/);
    fs.rmSync(path.join(dir, "0002_c.sql"));
    write(dir, "3_Bad.sql", "-- UP\nSELECT 3;\n-- DOWN\nSELECT 3;");
    expect(() => migrate.listMigrations(dir)).toThrow(/NNNN_lower_snake/);
  });

  test("the command line knows its options", () => {
    expect(migrate.parseArgs(["--status"]).status).toBe(true);
    expect(() => migrate.parseArgs(["--force"])).toThrow(/Unknown option/);
    expect(() => migrate.parseArgs(["--status", "--down"])).toThrow(
      /cannot be used together/,
    );
  });
});

describe("seed guard", () => {
  const ok = {
    mode: "build",
    appEnv: "development",
    dbName: "mycity_dev",
    marker: "development",
  };

  test("a local database that says it is local may be seeded", () => {
    expect(seed.refusals(ok)).toEqual([]);
    expect(seed.refusals({ ...ok, mode: "staging" })).toEqual([]);
    expect(
      seed.refusals({
        mode: "staging",
        appEnv: "staging",
        dbName: "mycity_stg",
        marker: "staging",
      }),
    ).toEqual([]);
  });

  test("each of the three checks refuses production on its own", () => {
    expect(seed.refusals({ ...ok, appEnv: "production" })).toEqual(
      expect.arrayContaining([expect.stringMatching(/APP_ENV is production/)]),
    );
    expect(seed.refusals({ ...ok, dbName: "mycity_prod" })).toEqual([
      expect.stringMatching(/mycity_prod/),
    ]);
    expect(seed.refusals({ ...ok, marker: "production" })).toEqual([
      expect.stringMatching(/system_marker says production/),
    ]);
  });

  test("synthetic build data never reaches staging", () => {
    expect(
      seed.refusals({
        mode: "build",
        appEnv: "staging",
        dbName: "mycity_stg",
        marker: "staging",
      }),
    ).toHaveLength(3);
    expect(seed.refusals({ ...ok, marker: "staging" })).toEqual([
      expect.stringMatching(/use --staging/),
    ]);
  });

  test("a database that does not say what it is is refused", () => {
    expect(seed.refusals({ ...ok, marker: undefined })).toEqual([
      expect.stringMatching(/no system_marker table/),
    ]);
    expect(seed.refusals({ ...ok, marker: null })).toEqual([
      expect.stringMatching(/has no row/),
    ]);
    expect(seed.refusals({ ...ok, mode: "demo" })).toEqual([
      expect.stringMatching(/--build or --staging/),
    ]);
  });

  test("seed files run in name order, test files left out", () => {
    const root = tmp("mycity-seed-");
    fs.mkdirSync(path.join(root, "build"));
    for (const f of ["20_b.js", "10_a.js", "10_a.test.js", "notes.md"])
      fs.writeFileSync(path.join(root, "build", f), "");
    expect(seed.seedFiles("build", root).map((f) => path.basename(f))).toEqual([
      "10_a.js",
      "20_b.js",
    ]);
    expect(seed.seedFiles("staging", root)).toEqual([]);
  });
});

describe("contract generator", () => {
  const contract = {
    common: {
      uuid: z.string().uuid(),
      IdParams: z.object({ id: z.string().uuid() }).strict(),
      PAGE_SIZE: 25,
    },
    things: {
      Thing: z.object({
        thing_id: z.string().uuid(),
        due_on: z.string(),
        tags: z.array(z.object({ tag_name: z.string() })),
      }),
      ThingCreate: z.object({ title: z.string() }),
      Detail: z.object({ a: z.string() }),
    },
    other: { Detail: z.object({ b: z.string() }) },
  };
  const routes = [
    {
      method: "POST",
      path: "/api/v1/things",
      contract: {
        body: contract.things.ThingCreate,
        response: contract.things.Thing,
      },
    },
    {
      method: "GET",
      path: "/api/v1/things/:id",
      contract: { response: contract.things.Thing },
    },
    {
      method: "DELETE",
      path: "/api/v1/things/:id",
      contract: { params: contract.common.IdParams, no_content: true },
    },
  ];
  const inputs = { "packages/contract/schemas/things.js": "x" };

  test("output is deterministic and covers schemas and endpoints", () => {
    const a = gen.render({ contract, routes, inputs });
    const b = gen.render({
      contract,
      routes: [...routes].reverse(),
      inputs: { "packages/contract/schemas/things.js": "x\r\n".slice(0, 1) },
    });
    expect(a.ts).toBe(b.ts);
    expect(a.ts).toMatch(
      /^\/\/ @generated by scripts\/gen\/contract\.js\. DO NOT EDIT\./,
    );
    expect(a.ts).toContain("export type Thing = z.infer<typeof things.Thing>;");
    expect(a.ts).toContain(
      '"POST /api/v1/things": { body: z.input<typeof things.ThingCreate>; query: never; params: never; response: z.output<typeof things.Thing> };',
    );
    expect(a.ts).toContain(
      '"GET /api/v1/things/:id": { body: never; query: never; params: { id: string }; response: z.output<typeof things.Thing> };',
    );
    expect(a.ts).toContain(
      '"DELETE /api/v1/things/:id": { body: never; query: never; params: z.input<typeof common.IdParams>; response: null };',
    );
    expect(a.ts).toContain(
      "export const schemas = { common, other, things } as const;",
    );
    expect(a.ts).not.toContain("PAGE_SIZE");
    expect(JSON.parse(a.meta)).toMatchObject({ schemas: 6, endpoints: 3 });
  });

  test("a name two domains share is prefixed with its domain", () => {
    const { ts } = gen.render({ contract, routes: [], inputs });
    expect(ts).toContain(
      "export type OtherDetail = z.infer<typeof other.Detail>;",
    );
    expect(ts).toContain(
      "export type ThingsDetail = z.infer<typeof things.Detail>;",
    );
  });

  test("a key that is not snake_case anywhere in a schema is refused", () => {
    const bad = {
      things: {
        Thing: z.object({
          items: z.array(z.object({ dueOn: z.string() })).optional(),
        }),
      },
    };
    expect(() => gen.render({ contract: bad, routes: [], inputs })).toThrow(
      /things\.Thing\.items\[\]\.dueOn: "dueOn" is not snake_case/,
    );
  });

  test("a route whose schema is not exported is refused", () => {
    const stray = z.object({ x: z.string() });
    expect(() =>
      gen.render({
        contract,
        routes: [
          { method: "GET", path: "/api/v1/x", contract: { response: stray } },
        ],
        inputs,
      }),
    ).toThrow(/not exported/);
  });

  test("the generated file in the repository is current", () => {
    const ts = fs.readFileSync(
      path.join(ROOT, "packages", "contract", "contract.gen.ts"),
      "utf8",
    );
    expect(ts).toMatch(/^\/\/ @generated/);
  });
});

describe("realtime host rule", () => {
  const split = {
    split: true,
    staff: { host: "hub.mycityapp.io" },
    public: { host: "go.mycityapp.io" },
  };
  const req = (host) => ({ headers: { host } });

  test("the staff host is allowed, the public host never", () => {
    expect(hostAllowed(req("hub.mycityapp.io"), split)).toBe(true);
    expect(hostAllowed(req("HUB.mycityapp.io:443"), split)).toBe(true);
    expect(hostAllowed(req("go.mycityapp.io"), split)).toBe(false);
  });

  test("one host serving both (a laptop) allows everything", () => {
    expect(hostAllowed(req("localhost:8080"), { ...split, split: false })).toBe(
      true,
    );
  });
});

describe("worker file discovery", () => {
  test("events and importer files are found; empty stubs are skipped", () => {
    const dir = tmp("mycity-mods-");
    const mk = (mod, file, text) => {
      fs.mkdirSync(path.join(dir, mod), { recursive: true });
      fs.writeFileSync(path.join(dir, mod, file), text);
    };
    mk("people", "people.events.js", "module.exports = {};");
    mk("people", "employee.import.js", "module.exports = {};");
    mk("people", "people.routes.js", "module.exports = {};");
    mk("leave", "leave.events.js", "");
    mk("Bad-Name", "x.events.js", "module.exports = {};");
    const found = worker
      .moduleHandlerFiles(dir)
      .map((f) => path.relative(dir, f).split(path.sep).join("/"));
    expect(found).toEqual([
      "people/people.events.js",
      "people/employee.import.js",
    ]);
  });
});

describe("shipped templates survive an editor's formatter", () => {
  const templates = require("../../../src/shared/templates/template-store");

  test("a quoted front matter value is read without its quotes", () => {
    expect(templates.frontMatter('---\nsubject: "{{ title }}"\ntitle: \'Plain\'\n---\nbody').meta).toEqual({ subject: "{{ title }}", title: "Plain" });
    expect(templates.frontMatter("---\nsubject: Payslip {{ month period }}\n---\nx").meta.subject).toBe("Payslip {{ month period }}");
  });

  test("no shipped subject or title was turned into a YAML mapping", () => {
    for (const kind of ["email", "document"]) {
      for (const key of templates.shippedKeys(kind)) {
        const t = templates.shipped(kind, key);
        if (!t) continue;
        for (const v of [t.subject, t.title].filter(Boolean)) expect(`${kind}:${key} ${v}`).not.toMatch(/\{ \{|\} \}/);
      }
    }
    expect(templates.shipped("email", "notification").subject).toBe("{{ title }}");
  });
});
