"use strict";
/**
 * The User Guide end to end (docs/guides/user-guide.md §5, §6.3): GET /user-guide on the real
 * migrations and the real chapters of docs/manual, through HTTP, as people with different
 * roles. Each reader receives only the chapters, sections, tasks and pictures their grants open.
 * Its search (§6.8 to §6.10): the words alone, the meaning index kept by the worker (with a
 * stand-in for the embedding model), the answer, a spoken search and Praxis AI's read.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/user-guide
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const ai = require("../../src/services/ai/llm.service");
const jobs = require("../../src/services/ai/jobs");
const transcription = require("../../src/services/ai/transcription");
const authorise = require("../../src/shared/ai/authorise");
const { AppError } = require("../../src/shared/errors");
const meaning = require("../../src/modules/user_guide/user_guide.meaning");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const PASSWORD = "Read-The-Guide7";
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x42\x82\x84webm"), Buffer.alloc(64)]);

/**
 * A stand-in for the embedding model: a text about signing in or passwords points one way, one
 * about leave another, anything else a third, so "nearness" is predictable.
 */
const TOPICS = [/password|locked out|sign.in|account/i, /\bleave\b|time off/i];
function fakeVector(text) {
  const v = new Array(ai.EMBEDDING_DIMENSIONS).fill(0);
  TOPICS.forEach((re, i) => {
    if (re.test(text)) v[i] = 1;
  });
  if (!v.some(Boolean)) v[ai.EMBEDDING_DIMENSIONS - 1] = 1;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
const fakeEmbed = (model = "text-embedding-3-small") =>
  jest.spyOn(ai, "embed").mockImplementation(async ({ input }) => {
    const texts = Array.isArray(input) ? input : [input];
    return { vectors: texts.map(fakeVector), model, vendor: "openai", run_id: null, cost_ngn: "0.00" };
  });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("the User Guide against the real migrations and chapters", () => {
  let app;
  const tokens = {};
  const people = {};

  const get = (who, path) => {
    const req = request(app).get(`/api/v1/user-guide${path}`);
    return who ? req.set("Authorization", `Bearer ${tokens[who]}`) : req;
  };
  async function contents(who) {
    const res = await get(who, "/");
    expect(res.status).toBe(200);
    return c.user_guide.GuideContents.parse(res.body);
  }
  async function chapter(who, slug) {
    const res = await get(who, `/chapters/${slug}`);
    expect(res.status).toBe(200);
    return c.user_guide.GuideChapter.parse(res.body);
  }
  /** Every section and task slug in a chapter. */
  const slugsOf = (ch) => ch.sections.flatMap((s) => [s.slug, ...s.tasks.map((t) => t.slug)]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const roster = [
      ["staff", "Obinna", "Eke", "employee", "Field Officer", "0809 765 4321"],
      ["ops", "Halima", "Garba", "operations_people", "Operations Lead", "08031234567"],
      ["admin", "Tunde", "Bello", "administrator", "Systems Lead", "0805 111 2222"],
    ];
    let ip = 0;
    for (const [key, first, last, role, job, phone] of roster) {
      await tx((client) =>
        createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${key}@mycity.test`,
              phone,
              job_title: job,
              department_name: "Operations",
              start_date: "2026-02-02",
              employment_type: "full_time",
              work_pattern: "hybrid",
            },
            role_code: role,
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        ),
      );
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.71.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
      const { rows } = await pool.query(
        "SELECT u.user_id, u.employee_id, array_agg(ur.role_id) AS role_ids FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id WHERE u.email = $1 GROUP BY u.user_id",
        [`${key}@mycity.test`],
      );
      people[key] = { ...rows[0], is_ceo: false };
    }
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out, the guide answers 401", async () => {
    expect((await get(null, "/")).status).toBe(401);
    expect((await get(null, "/images/people/people-employees.desktop.png")).status).toBe(401);
  });

  test("everyone reads Getting Started; only who may open People and Settings reads theirs", async () => {
    const staff = (await contents("staff")).chapters.map((ch) => ch.slug);
    expect(staff[0]).toBe("getting-started");
    expect(staff).not.toContain("people");
    expect(staff).not.toContain("settings");

    const ops = (await contents("ops")).chapters.map((ch) => ch.slug);
    expect(ops).toEqual(expect.arrayContaining(["getting-started", "people", "settings"]));
  });

  test("a chapter the reader may not read is not there, and neither is one that does not exist", async () => {
    expect((await get("staff", "/chapters/people")).status).toBe(404);
    expect((await get("ops", "/chapters/nothing-here")).status).toBe(404);
    expect((await get("ops", "/chapters/Not_A_Slug")).status).toBe(422);
  });

  test("Settings · Integrations is read only by who holds the integrations grant", async () => {
    const ops = slugsOf(await chapter("ops", "settings"));
    expect(ops).toContain("settings-users");
    expect(ops).not.toContain("settings-integrations");
    expect(ops).not.toContain("settings-integrations-edit");

    const admin = slugsOf(await chapter("admin", "settings"));
    expect(admin).toEqual(expect.arrayContaining(["settings-integrations", "settings-integrations-check", "settings-integrations-edit"]));
  });

  test("a task is read only by who holds what it needs", async () => {
    const ops = slugsOf(await chapter("ops", "people"));
    expect(ops).toEqual(expect.arrayContaining(["people-employees", "people-add-employee", "people-add-refused"]));
  });

  test("the Quick Start shows each reader only the cards they can follow", async () => {
    const cards = async (who) => {
      const res = await get(who, "/quick-start");
      expect(res.status).toBe(200);
      return c.user_guide.GuideChapter.parse(res.body).sections.map((s) => s.slug);
    };
    const staff = await cards("staff");
    expect(staff).toEqual(expect.arrayContaining(["qs-sign-in", "qs-search", "qs-notifications", "qs-help"]));
    expect(staff).not.toContain("qs-add-employee");
    expect(staff).not.toContain("qs-roles");
    expect(await cards("ops")).toEqual(expect.arrayContaining(["qs-add-employee", "qs-import"]));
  });

  test("a picture is sent only for a part the reader may read", async () => {
    const ok = await get("ops", "/images/settings/settings-users.desktop.png");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/^image\/png/);
    expect(ok.headers["cache-control"]).toBe("private, max-age=3600");

    expect((await get("ops", "/images/settings/settings-integrations.desktop.png")).status).toBe(404);
    expect((await get("admin", "/images/settings/settings-integrations.desktop.png")).status).toBe(200);
    expect((await get("staff", "/images/people/people-employees.phone.png")).status).toBe(404);
    expect((await get("ops", "/images/people/no-such-picture.desktop.png")).status).toBe(404);
    expect((await get("ops", "/images/people/..%2F..%2Fsecret.desktop.png")).status).toBe(422);
  });

  test("⌘K finds the guide's sections the reader may read, and opens the guide at them", async () => {
    const search = async (who, q) => {
      const res = await request(app).get("/api/v1/search").query({ q, type: "guide_section" }).set("Authorization", `Bearer ${tokens[who]}`);
      expect(res.status).toBe(200);
      const group = c.search.SearchResult.parse(res.body).groups.find((g) => g.type === "guide_section");
      return group ? group.items : [];
    };
    const add = (await search("ops", "add an employee")).find((i) => i.id === "people-add-employee");
    expect(add).toMatchObject({ title: "Add an employee", sub: "People · Employees" });
    // It opens the guide at the step that answers, numbered as this reader reads it.
    expect(add.link).toMatch(/^\/knowledge\?tab=user-guide&id=people-add-employee&step=\d+$/);

    expect((await search("staff", "add an employee")).map((i) => i.id)).not.toContain("people-add-employee");
    expect((await search("ops", "integrations")).map((i) => i.id)).not.toContain("settings-integrations");
    expect((await search("admin", "integrations")).map((i) => i.id)).toContain("settings-integrations");
  });

  /* ───────────── Search (§6.8 to §6.10) ───────────── */

  const post = (who, path, body) => request(app).post(`/api/v1/user-guide${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body);
  async function hits(who, q, page = 1) {
    const res = await post(who, "/search", { q, page });
    expect(res.status).toBe(200);
    return c.user_guide.GuideSearchPage.parse(res.body);
  }

  test("with no embedding model the words alone answer, cut to the reader, a page of 25", async () => {
    const ops = await hits("ops", "add an employee");
    expect(ops.data[0]).toMatchObject({ anchor: "people-add-employee", kind: "task", chapter: "people", by: "words" });
    expect(ops.data[0].snippet.some((r) => r.hit)).toBe(true);
    expect((await hits("staff", "add an employee")).data.map((h) => h.anchor)).not.toContain("people-add-employee");

    const many = await hits("ops", "press");
    expect(many.data).toHaveLength(25);
    expect(many.page).toMatchObject({ number: 1, size: 25, has_next: true });
    const next = await hits("ops", "press", 2);
    expect(next.page.number).toBe(2);
    expect(next.data[0].anchor).not.toBe(many.data[0].anchor);

    expect((await hits("ops", "a")).data).toEqual([]);
    expect((await post("ops", "/search", { q: "x".repeat(201) })).status).toBe(422);
    expect((await post("ops", "/search", { q: "leave", limit: 100 })).status).toBe(422);
    expect((await request(app).post("/api/v1/user-guide/search").send({ q: "leave" })).status).toBe(401);
    expect((await request(app).get("/api/v1/user-guide/search").query({ q: "leave" }).set("Authorization", `Bearer ${tokens.ops}`)).status).toBe(404);
  });

  test("the meaning index: every passage embedded once, a sync with nothing new spends nothing, a new model rebuilds it", async () => {
    jest.spyOn(jobs, "walk").mockResolvedValue([{ provider: "openai", model: "text-embedding-3-small", display_name: "small", position: 1 }]);
    const embed = fakeEmbed();
    const first = await meaning.sync();
    expect(first.added).toBeGreaterThan(1000);
    expect(first).toMatchObject({ model: "text-embedding-3-small", removed: 0 });
    const count = async () => (await pool.query("SELECT count(*)::int AS n FROM user_guide_passage")).rows[0].n;
    expect(await count()).toBe(first.passages);
    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ purpose: "guide-search", module: "knowledge", actor: null }));

    embed.mockClear();
    expect(await meaning.sync()).toEqual({ model: "text-embedding-3-small", added: 0, removed: 0, passages: first.passages });
    expect(embed).not.toHaveBeenCalled();

    // A passage nothing says any more goes; a changed model brings a whole new index.
    await pool.query("INSERT INTO user_guide_passage (text_hash, model, embedding) VALUES ($1, 'text-embedding-3-small', $2::vector)", ["0".repeat(64), JSON.stringify(fakeVector("old"))]);
    expect((await meaning.sync()).removed).toBe(1);
    jobs.walk.mockResolvedValue([{ provider: "openai", model: "text-embedding-3-large", display_name: "large", position: 1 }]);
    fakeEmbed("text-embedding-3-large");
    expect(await meaning.sync()).toMatchObject({ added: first.passages, removed: first.passages });
    jobs.walk.mockResolvedValue([{ provider: "openai", model: "text-embedding-3-small", display_name: "small", position: 1 }]);
    fakeEmbed();
    await meaning.sync();

    const { rows } = await pool.query("SELECT payload FROM event_log WHERE event_key = 'user_guide.indexed' ORDER BY occurred_at");
    expect(rows.length).toBe(4);
    expect(Object.keys(rows[0].payload).sort()).toEqual(["added", "model", "passages", "removed"]);

    // With no embedding model set up a sync does nothing at all.
    jobs.walk.mockResolvedValue([]);
    expect(await meaning.sync()).toEqual({ skipped: "embeddings not set up" });
  });

  test("a description the words miss is found by its meaning, and only among what the reader may read", async () => {
    fakeEmbed();
    const staff = await hits("staff", "locked out of my account");
    expect(staff.data[0].by).not.toBe("words");
    expect(staff.data.slice(0, 5).map((h) => h.chapter)).toContain("getting-started");
    // Settings explains resetting someone's password; staff may not read Settings.
    expect(staff.data.map((h) => h.chapter)).not.toContain("settings");
    expect(staff.data.map((h) => h.anchor)).toContain("start-forgot-password");

    // A failing model costs only the meaning half.
    ai.embed.mockRejectedValue(new AppError("AI_VENDOR_CONFIG", "Not set up correctly.", 503));
    expect((await hits("ops", "add an employee")).data[0].anchor).toBe("people-add-employee");
  });

  test("an answer is written on the Fast job from the reader's own results, each sentence citing them", async () => {
    fakeEmbed();
    const complete = jest.spyOn(ai, "complete").mockImplementation(async (req) => {
      expect(req).toMatchObject({ purpose: "guide-answer", module: "knowledge", egress: "reasoning" });
      expect(req.input.passages.length).toBeGreaterThan(0);
      expect(req.input.passages.length).toBeLessThanOrEqual(6);
      return { output: { answered: true, sentences: [{ text: "On the sign-in screen, press Forgot Password.", sources: [1, 1] }] }, vendor: "gemini", model: "flash-lite", run_id: "r", text: "" };
    });
    const res = await post("staff", "/answer", { q: "I forgot my password" });
    expect(res.status).toBe(200);
    const a = c.user_guide.GuideAnswer.parse(res.body);
    expect(a.found).toBe(true);
    expect(a.sentences).toEqual([{ text: "On the sign-in screen, press Forgot Password.", sources: [1] }]);
    expect(a.sources[0].chapter).toBe("getting-started");
    expect(complete).toHaveBeenCalledTimes(1);
    // The model is shown only what this reader may read.
    const shown = JSON.stringify(complete.mock.calls[0][0].input);
    expect(shown).not.toMatch(/Send Reset Link/);

    complete.mockRejectedValue(new AppError("AI_DISABLED", "AI is switched off.", 503));
    const off = c.user_guide.GuideAnswer.parse((await post("staff", "/answer", { q: "I forgot my password" })).body);
    expect(off).toMatchObject({ found: false, sentences: [] });
    expect(off.sources.length).toBeGreaterThan(0);

    complete.mockResolvedValue({ output: { answered: false, sentences: [] }, vendor: "gemini", model: "flash-lite", run_id: "r", text: "" });
    expect((await post("staff", "/answer", { q: "What is the weather?" })).body.found).toBe(false);
    expect((await post("staff", "/answer", { q: "hi" })).status).toBe(422);
  });

  test("with no model set up the answer is never the placeholder", async () => {
    jest.spyOn(ai, "embed").mockResolvedValue({ vectors: null, model: null, vendor: "stub", run_id: null, cost_ngn: "0.00" });
    const res = await post("ops", "/answer", { q: "How do I add an employee?" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ found: false, sentences: [] });
  });

  test("a spoken search: transcribed on Guide Voice Search's chain, and its recording removed", async () => {
    jest.spyOn(transcription.DEFAULT_AUDIO, "mp3").mockResolvedValue(Buffer.from("mp3"));
    const res = await request(app).post("/api/v1/user-guide/transcribe").set("Authorization", `Bearer ${tokens.staff}`).attach("file", WEBM, "search.webm");
    expect(res.status).toBe(200);
    expect(c.assistant.AiTranscript.parse(res.body)).toMatchObject({ document_id: expect.any(String) });
    const run = (await pool.query("SELECT purpose, module_key FROM ai_run WHERE purpose = 'guide-voice'")).rows[0];
    expect(run).toEqual({ purpose: "guide-voice", module_key: "knowledge" });
    expect((await pool.query("SELECT count(*)::int AS n FROM document WHERE doc_type = 'guide_voice_search'")).rows[0].n).toBe(0);
  });

  test("Praxis AI's guide.search reads what the asker may read, a page, each row citing its section", async () => {
    jest.spyOn(ai, "embed").mockResolvedValue({ vectors: null, model: null, vendor: "stub", run_id: null, cost_ngn: "0.00" });
    const ops = await authorise.runRead(pool, people.ops, "guide.search", { q: "add an employee" });
    expect(ops.data[0]).toMatchObject({ slug: "people-add-employee", chapter: "People" });
    expect(ops.data[0].text.length).toBeLessThanOrEqual(400);
    expect(ops.data.length).toBeLessThanOrEqual(25);
    expect(ops.citations[0]).toMatchObject({ type: "guide_section", id: "people-add-employee", link: "/knowledge?tab=user-guide&id=people-add-employee" });
    const staff = await authorise.runRead(pool, people.staff, "guide.search", { q: "add an employee" });
    expect(staff.data.map((r) => r.slug)).not.toContain("people-add-employee");
  });
});
