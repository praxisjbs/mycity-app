"use strict";
/**
 * Training end to end (docs/guides/knowledge.md §5 to §6.11): a course built from a file, a YouTube
 * video, a course link and a lesson; published with a signature; assigned to a department, to
 * everyone and to named people; tasks and notices set by the worker; a Library start moved onto an
 * assignment; Mark Done, Undone, proof and completion with its certificate number and hash; the
 * task closed; withdrawing, Remind Overdue, the reminder engine, joiners, leavers and archiving;
 * Draft Lesson; and 300 people assigned at once. On the real migrations and through HTTP (every
 * response parsed with its contract, APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/training
 *
 * Dates are read from today in Lagos, so the file runs on any day. Every person is invented.
 */
const request = require("supertest");
const sharp = require("sharp");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const canonical = require("../../src/shared/documents/canonical");
const realtime = require("../../src/services/realtime/emitter");
const reminders = require("../../src/modules/notifications/notifications.reminders");
const training = require("../../src/modules/training/training.service");
const documents = require("../../src/shared/documents/generate");
const storage = require("../../src/services/storage/storage.service");
const pdfText = require("../../src/services/media/pdf-text");
const chromium = require("../../src/services/pdf/chromium");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Training-Rules9Test";
const TODAY = lagos.today();
const day = (n) => lagos.addDays(TODAY, n);
const YEAR = TODAY.slice(0, 4);
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const LESSON = "## Why it matters\n\nPersonal data is anything that names a person. Keep it locked.\n\n- Lock your screen";
/** The same lesson as the editor sends it. */
const LESSON_HTML = "<h2>Why it matters</h2><p>Personal data is anything that names a person. Keep it <b>locked</b>.</p><ul><li>Lock your screen</li></ul>";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 20; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("training against the real migrations", () => {
  let app;
  let signature;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      put: (path, body = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
      upload: (name, buffer, type) =>
        auth(request(app).post("/api/v1/documents")).attach("file", buffer, { filename: name, contentType: type }),
    };
  };

  const employeeId = (who) => people[who].employee.employee_id;
  const userId = (who) => people[who].user.user_id;
  const noticesOf = (who, key) =>
    q("SELECT title, body, entity_type, entity_id FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [
      userId(who),
      key,
    ]).then((r) => r.rows);
  const enrolmentOf = (courseId, who) =>
    one("SELECT * FROM training_enrolment WHERE training_course_id = $1 AND employee_id = $2", [courseId, employeeId(who)]);
  const taskOf = (enrolmentId) => one("SELECT task_id, title, status, due_at, primary_assignee_id, entity_type FROM task WHERE entity_type = 'training_enrolment' AND entity_id = $1", [enrolmentId]);

  async function signIn(who) {
    ip += 1;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.75.0.${ip}`)
      .send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  const make = (who, first, last, role, { department = "Programmes", ceo = false, title = "Officer" } = {}) =>
    tx(async (client) => {
      people[who] = await createAdmin(
        client,
        {
          employee: {
            first_name: first,
            last_name: last,
            work_email: `${who}@mycity.test`,
            phone: "08031234567",
            job_title: title,
            department_name: department,
            start_date: "2026-01-05",
            employment_type: "full_time",
            work_pattern: "on_site",
          },
          role_code: role,
          is_ceo: ceo,
        },
        PASSWORD,
        { allowAdditional: true },
      );
    });

  /** A course with the four kinds of item, published, as Knowledge Hub · Training builds it. */
  async function builtCourse(title, settings = {}) {
    const made = await as("ops").post("/training/courses", { title, summary: "What every member of staff must know" });
    expect(made.status).toBe(201);
    const id = made.body.training_course_id;
    const staged = await as("ops").upload("handbook.pdf", pdf(), "application/pdf");
    expect(staged.status).toBe(201);
    for (const item of [
      { kind: "file", title: "The Handbook", document_id: staged.body.document_id, minutes: 20 },
      { kind: "video", title: "Watch the Briefing", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", minutes: 5 },
      { kind: "link", title: "Outside Course", url: "https://learn.example.org/course/42" },
      { kind: "lesson", title: "Key Rules", lesson_html: LESSON_HTML, minutes: 10 },
    ])
      expect((await as("ops").post(`/training/courses/${id}/items`, item)).status).toBe(201);
    if (Object.keys(settings).length) expect((await as("ops").patch(`/training/courses/${id}`, settings)).status).toBe(200);
    const published = await as("ops").post(`/training/courses/${id}/publish`, { signature });
    expect(published.status).toBe(200);
    return published.body;
  }

  /** Mark every item of a course done as `who`; answers the last MyCourse. */
  async function finish(who, course) {
    let last;
    for (const item of course.items) {
      last = await as(who).post(`/training/me/items/${item.training_item_id}/done`);
      expect(last.status).toBe(200);
    }
    return last.body;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const png = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
      .png()
      .toBuffer();
    signature = `data:image/png;base64,${png.toString("base64")}`;
    await make("ops", "Ngozi", "Eze", "operations_people", { title: "People Lead" });
    await make("staff", "Femi", "Ola", "employee");
    await make("sales", "Tayo", "Ade", "employee", { department: "Sales" });
    await make("seller", "Kemi", "Bassey", "employee", { department: "Sales" });
    await make("ceo", "Bola", "Okeke", "management", { ceo: true });
    ids.sales = people.sales.employee.department_id;
    ids.employeeRole = (await one("SELECT role_id FROM role WHERE code = 'employee'")).role_id;
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) tokens[who] = await signIn(who);
  }, 60_000);

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("only training.manage builds courses: numbered drafts, four kinds of item, a YouTube id read from its link", async () => {
    const refused = await as("staff").get("/training/courses");
    expect(refused.status).toBe(403);
    expect((await as("staff").post("/training/courses", { title: "My Course" })).status).toBe(403);

    const res = await as("ops").post("/training/courses", { title: "Data Protection Basics", summary: "NDPA for everyone" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ number: "TRN-0001", state: "draft", library: false, issue_certificate: true, items: [], minutes: null });
    ids.draft = res.body.training_course_id;
    expect((await as("ops").post("/training/courses", { title: "No" })).status).toBe(422);

    // A file is an upload staged by the builder; anything else is refused.
    const notStaged = await as("ops").post(`/training/courses/${ids.draft}/items`, {
      kind: "file",
      title: "Handbook",
      document_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(notStaged.body.error.code).toBe("DOCUMENT_NOT_STAGED");
    const staged = await as("ops").upload("handbook.pdf", pdf(), "application/pdf");
    const file = await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "file", title: "The Handbook", document_id: staged.body.document_id, minutes: 20 });
    expect(file.status).toBe(201);
    expect(file.body.items[0]).toMatchObject({ kind: "file", position: 1, document_name: "handbook.pdf", document_type: "application/pdf", youtube_id: null });
    const doc = await one("SELECT doc_type, entity_type, entity_id FROM document WHERE document_id = $1", [staged.body.document_id]);
    expect(doc).toEqual({ doc_type: "training_material", entity_type: "training_course", entity_id: ids.draft });

    const video = await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "video", title: "Briefing", url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(video.body.items[1]).toMatchObject({ kind: "video", youtube_id: "dQw4w9WgXcQ" });
    expect((await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "video", title: "Plain", url: "http://youtu.be/x" })).status).toBe(422);
    const lesson = await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "lesson", title: "Rules", lesson_html: LESSON_HTML, minutes: 10 });
    const rules = lesson.body.items[2];
    expect(rules.lesson[0]).toMatchObject({ kind: "heading" });
    // Kept as Markdown through the one converter, and given back as the editor loads it.
    expect((await one("SELECT lesson_markdown FROM training_item WHERE training_item_id = $1", [rules.training_item_id])).lesson_markdown).toBe(LESSON.replace("Keep it locked", "Keep it **locked**"));
    expect(rules.lesson_html).toContain("<h2>Why it matters</h2>");
    const short = await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "lesson", title: "Short", lesson_html: "<p>Twenty letters <b></b><i></i>here</p>" });
    expect(short.status).toBe(422);
    const tooLong = await as("ops").post(`/training/courses/${ids.draft}/items`, { kind: "lesson", title: "Long", lesson_html: `<p>${"word ".repeat(4_100)}</p>` });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.fields.lesson_html).toEqual(["At most 20,000 characters"]);
    expect(lesson.body.minutes).toBe(30);

    // The whole item again: a video can become a course link.
    const linkId = video.body.items[1].training_item_id;
    const changed = await as("ops").patch(`/training/items/${linkId}`, { kind: "link", title: "Outside Course", url: "https://learn.example.org/c/1" });
    expect(changed.body.items[1]).toMatchObject({ kind: "link", youtube_id: null, url: "https://learn.example.org/c/1" });

    // Every item, once, in its new order.
    const all = changed.body.items.map((i) => i.training_item_id);
    expect((await as("ops").put(`/training/courses/${ids.draft}/order`, { item_ids: all.slice(1) })).body.error.code).toBe("VALIDATION_FAILED");
    const ordered = await as("ops").put(`/training/courses/${ids.draft}/order`, { item_ids: [all[2], all[0], all[1]] });
    expect(ordered.body.items.map((i) => i.title)).toEqual(["Rules", "The Handbook", "Outside Course"]);
    expect(ordered.body.items.map((i) => i.position)).toEqual([1, 2, 3]);

    const removed = await as("ops").delete(`/training/items/${all[1]}`);
    expect(removed.body.items.map((i) => [i.title, i.position])).toEqual([["Rules", 1], ["The Handbook", 2]]);
    expect((await as("ops").get(`/training/courses/${ids.draft}`)).body.state).toBe("draft");
  });

  test("Publish Course needs an item and the publisher's signature, kept in the vault; once", async () => {
    const empty = await as("ops").post("/training/courses", { title: "Empty Course" });
    ids.empty = empty.body.training_course_id;
    expect((await as("ops").post(`/training/courses/${ids.empty}/publish`, { signature })).body.error.code).toBe("NO_ITEMS");
    // Assigning waits for publication.
    expect((await as("ops").post(`/training/courses/${ids.empty}/assignments`, { everyone: true })).body.error.code).toBe("COURSE_NOT_PUBLISHED");

    const res = await as("ops").post(`/training/courses/${ids.draft}/publish`, { signature });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "published", signer_name: "Ngozi Eze", signer_title: "People Lead", published_by_name: "Ngozi Eze" });
    const row = await one("SELECT signature_document_id FROM training_course WHERE training_course_id = $1", [ids.draft]);
    expect(await one("SELECT doc_type, entity_id FROM document WHERE document_id = $1", [row.signature_document_id])).toEqual({
      doc_type: "training_signature",
      entity_id: ids.draft,
    });
    expect((await as("ops").post(`/training/courses/${ids.draft}/publish`, { signature })).body.error.code).toBe("COURSE_PUBLISHED");
    const list = await as("ops").get("/training/courses?state=published");
    expect(list.body.data).toEqual([expect.objectContaining({ number: "TRN-0001", items: 2, assigned: 0 })]);
  });

  test("assigning a department enrols its people now; the worker sets each task and notice; My Training lists it", async () => {
    ids.course = (await builtCourse("Code of Conduct")).training_course_id;
    const res = await as("ops").post(`/training/courses/${ids.course}/assignments`, {
      everyone: false,
      department_ids: [ids.sales],
      due_within_days: 7,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ audience_text: "Sales", enrolled: 2, due_within_days: 7, keep_assigning: true, created_by_name: "Ngozi Eze" });
    ids.salesAssignment = res.body.training_assignment_id;

    const place = await enrolmentOf(ids.course, "sales");
    expect(place).toMatchObject({ training_assignment_id: ids.salesAssignment, task_id: null, started_at: null });
    expect(lagos.dateOf(place.due_on)).toBe(day(7));

    await drain();
    const task = await taskOf(place.training_enrolment_id);
    expect(task).toMatchObject({ title: "Complete Code of Conduct", status: "todo", primary_assignee_id: employeeId("sales") });
    expect(lagos.dateOf(task.due_at)).toBe(day(7));
    expect((await enrolmentOf(ids.course, "sales")).task_id).toBe(task.task_id);
    const [notice] = await noticesOf("sales", "training.enrolled");
    expect(notice).toMatchObject({ title: "Training assigned", entity_type: "training_enrolment", entity_id: place.training_enrolment_id });
    expect(notice.body).toMatch(/^Code of Conduct, due \d{2}\/\d{2}\/\d{4}\.$/);
    expect(await noticesOf("staff", "training.enrolled")).toEqual([]);

    const todo = await as("sales").get("/training/me");
    expect(todo.body.data).toEqual([expect.objectContaining({ number: ids.courseNumber || expect.any(String), status: "not_started", items_total: 4, items_done: 0, due_on: day(7) })]);
    expect((await as("staff").get("/training/me")).body.data).toEqual([]);
    // Not assigned and not in the Library: nobody else's course.
    expect((await as("staff").get(`/training/me/courses/${ids.course}`)).status).toBe(404);
    // The task's link (the enrolment) opens the course too.
    expect((await as("sales").get(`/training/me/courses/${place.training_enrolment_id}`)).body).toMatchObject({ training_course_id: ids.course, enrolled: true });

    const peopleList = await as("ops").get(`/training/courses/${ids.course}/people?status=not_started`);
    expect(peopleList.body.page.total).toBe(2);
    expect(peopleList.body.data[0]).toMatchObject({ assigned: true, items_total: 4, certificate_ready: false });
  });

  test("a Library course: anyone starts it; an assignment later moves them onto it with its due date", async () => {
    await as("ops").patch(`/training/courses/${ids.course}`, { library: true });
    const library = await as("staff").get("/training/me?list=library");
    expect(library.body.data.map((r) => r.training_course_id)).toEqual([ids.course]);
    expect(library.body.data[0]).toMatchObject({ status: null, minutes: 35 });
    // Marking an item before starting is refused.
    const course = (await as("staff").get(`/training/me/courses/${ids.course}`)).body;
    expect(course).toMatchObject({ enrolled: false, status: null });
    expect((await as("staff").post(`/training/me/items/${course.items[0].training_item_id}/done`)).body.error.code).toBe("NOT_STARTED");

    const started = await as("staff").post(`/training/me/courses/${ids.course}/start`);
    expect(started.body).toMatchObject({ enrolled: true, status: "in_progress", due_on: null });
    expect((await as("staff").get("/training/me?list=in_progress")).body.data).toHaveLength(1);
    expect((await as("staff").get("/training/me?list=library")).body.data).toEqual([]);

    // Everyone, with a shorter due date: the Library starter is moved on; the Sales people keep one place, the earlier date.
    const everyone = await as("ops").post(`/training/courses/${ids.course}/assignments`, { everyone: true, due_within_days: 3 });
    expect(everyone.body).toMatchObject({ audience_text: "Everyone" });
    const moved = await enrolmentOf(ids.course, "staff");
    expect(moved.training_assignment_id).toBe(everyone.body.training_assignment_id);
    expect(lagos.dateOf(moved.due_on)).toBe(day(3));
    const sales = await enrolmentOf(ids.course, "sales");
    expect(sales.training_assignment_id).toBe(ids.salesAssignment);
    expect(lagos.dateOf(sales.due_on)).toBe(day(3));
    expect((await q("SELECT count(*)::int AS n FROM training_enrolment WHERE training_course_id = $1", [ids.course])).rows[0].n).toBe(5);

    await drain();
    expect(await taskOf(moved.training_enrolment_id)).toMatchObject({ title: "Complete Code of Conduct" });
    // One task each, however many assignments reached them.
    expect((await q("SELECT count(*)::int AS n FROM task WHERE entity_type = 'training_enrolment' AND primary_assignee_id = $1", [employeeId("sales")])).rows[0].n).toBe(1);
  });

  test("Mark Done in any order, Undone until completion; the last completes it with a certificate number and hash, and the task closes", async () => {
    const course = (await as("sales").get(`/training/me/courses/${ids.course}`)).body;
    const [a, b, c, d] = course.items.map((i) => i.training_item_id);
    const first = await as("sales").post(`/training/me/items/${c}/done`);
    expect(first.body).toMatchObject({ status: "in_progress", completed_at: null });
    expect(first.body.items.find((i) => i.training_item_id === c).done_at).toEqual(expect.any(String));
    const undone = await as("sales").post(`/training/me/items/${c}/undone`);
    expect(undone.body.items.every((i) => i.done_at === null)).toBe(true);

    for (const id of [d, a, b]) await as("sales").post(`/training/me/items/${id}/done`);
    const last = await as("sales").post(`/training/me/items/${c}/done`);
    expect(last.body).toMatchObject({ status: "completed", certificate_number: `CERT-${YEAR}-0001`, certificate_ready: false });
    const place = await enrolmentOf(ids.course, "sales");
    expect(place.certificate_hash).toBe(
      canonical.hash("TRAINING_CERTIFICATE", {
        number: `CERT-${YEAR}-0001`,
        holder_name: "Tayo Ade",
        course_number: course.number,
        course_title: "Code of Conduct",
        completed_on: TODAY,
        publisher_name: "Ngozi Eze",
        publisher_title: "People Lead",
      }),
    );
    expect((await as("sales").post(`/training/me/items/${c}/undone`)).body.error.code).toBe("COURSE_COMPLETED");

    await drain();
    expect(await taskOf(place.training_enrolment_id)).toMatchObject({ status: "done" });
    expect((await as("sales").get("/training/me?list=completed")).body.data).toEqual([
      expect.objectContaining({ status: "completed", certificate_number: `CERT-${YEAR}-0001` }),
    ]);
  });

  test("the certificate: issued after completion, drawn on one A4 page with the facts as issued, told, downloaded and verified", async () => {
    const place = await enrolmentOf(ids.course, "sales");
    expect(place).toMatchObject({ certificate_holder_name: "Tayo Ade", certificate_course_title: "Code of Conduct" });
    // The worker generated it after the completion committed; the PDF is still to render.
    const doc = await one("SELECT document_id, doc_type, entity_type, entity_id, subject_employee_id, sensitivity, render_status, title FROM document WHERE document_id = $1", [place.certificate_document_id]);
    expect(doc).toMatchObject({ doc_type: "training_certificate", entity_type: "training_enrolment", entity_id: place.training_enrolment_id, subject_employee_id: employeeId("sales"), sensitivity: "personal", render_status: "pending", title: `CERT-${YEAR}-0001` });
    expect((await as("sales").get(`/training/me/courses/${ids.course}`)).body).toMatchObject({ certificate_ready: false });
    // Not verifiable until its PDF exists.
    expect((await request(app).get(`/api/public/v1/verify/CERT-${YEAR}-0001`)).status).toBe(404);

    // Download Certificate waits for it, on the device that asked; nobody else waits on it.
    const pending = await as("sales").post(`/training/me/courses/${ids.course}/certificate`);
    expect(pending.status).toBe(202);
    expect(pending.body).toEqual({ document_id: doc.document_id, file_name: `CERT-${YEAR}-0001.pdf`, status: "pending" });
    expect((await as("sales").get(`/exports/${doc.document_id}`)).body.status).toBe("pending");
    expect((await as("staff").get(`/exports/${doc.document_id}`)).status).toBe(404);

    const rendered = await documents.renderPending(doc.document_id, { db: pool });
    expect(rendered).toMatchObject({ render_status: "done" });
    expect(rendered.locked_at).toBeTruthy();
    const bytes = await storage.get(rendered.storage_key);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
    const text = await pdfText.read(rendered.storage_key);
    for (const words of ["Tayo Ade", "Code of Conduct", `CERT-${YEAR}-0001`, "Ngozi Eze", "People Lead", "has successfully completed the training"])
      expect(text).toContain(words);
    // Letter-spaced headings read a letter at a time.
    for (const words of ["CERTIFICATE", "ofCompletion", "THISISTOCERTIFYTHAT", "PUBLISHEDTHISTRAINING", "LEARNING&DEVELOPMENT"])
      expect(text.replace(/\s+/g, "")).toContain(words);

    await drain();
    expect(await noticesOf("sales", "training.certificate_ready")).toEqual([
      { title: "Certificate ready", body: `Code of Conduct, CERT-${YEAR}-0001.`, entity_type: "training_enrolment", entity_id: place.training_enrolment_id },
    ]);
    expect((await as("sales").get("/training/me?list=completed")).body.data[0]).toMatchObject({ certificate_ready: true });
    const done = await as("sales").post(`/training/me/courses/${place.training_enrolment_id}/certificate`);
    expect(done.body).toMatchObject({ status: "done" });

    // The person's and training.manage's only.
    expect((await as("sales").get(`/documents/${doc.document_id}/content`)).headers["content-type"]).toBe("application/pdf");
    expect((await as("ops").get(`/documents/${doc.document_id}/content`)).status).toBe(200);
    expect((await as("staff").get(`/documents/${doc.document_id}/content`)).status).toBe(404);
    expect((await as("ops").post(`/training/enrolments/${place.training_enrolment_id}/certificate`)).body).toMatchObject({ status: "done" });
    expect((await as("staff").post(`/training/enrolments/${place.training_enrolment_id}/certificate`)).status).toBe(403);
    // A person not on the course, or on it without a certificate, has none to download.
    expect((await as("staff").post(`/training/me/courses/${ids.course}/certificate`)).body.error.code).toBe("NO_CERTIFICATE");

    // Verify a Document: by its number alone, in any case; the facts as issued, the two verdicts.
    const verify = (n = `CERT-${YEAR}-0001`) => request(app).get(`/api/public/v1/verify/${n}`);
    const res = await verify(`cert-${YEAR}-0001`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reference: `CERT-${YEAR}-0001`,
      document_type: "training_certificate",
      title: "Code of Conduct",
      status: "completed",
      content: "matches",
      artifact: "matches",
      signers: [{ name: "Ngozi Eze", title: "People Lead", role: "mycity", status: "signed", signed_at: null, method: null }],
      certificate: { holder_name: "Tayo Ade", course_title: "Code of Conduct", completed_on: TODAY, items: 4 },
    });
    // Renamed later, the certificate stays as issued and still verifies.
    await as("ops").patch(`/training/courses/${ids.course}`, { title: "Code of Conduct 2027" });
    await q("UPDATE employee SET last_name = 'Adebayo' WHERE employee_id = $1", [employeeId("sales")]);
    expect((await verify()).body).toMatchObject({ content: "matches", artifact: "matches", certificate: { holder_name: "Tayo Ade", course_title: "Code of Conduct" } });
    await q("UPDATE employee SET last_name = 'Ade' WHERE employee_id = $1", [employeeId("sales")]);
    await as("ops").patch(`/training/courses/${ids.course}`, { title: "Code of Conduct" });
    // Its facts altered in the database: the content differs. Its file replaced: the artifact differs.
    await q("UPDATE training_enrolment SET certificate_holder_name = 'Someone Else' WHERE training_enrolment_id = $1", [place.training_enrolment_id]);
    expect((await verify()).body).toMatchObject({ content: "differs", artifact: "matches" });
    await q("UPDATE training_enrolment SET certificate_holder_name = 'Tayo Ade' WHERE training_enrolment_id = $1", [place.training_enrolment_id]);
    await storage.put(rendered.storage_key, Buffer.concat([bytes, Buffer.from("%")]), { overwrite: true });
    expect((await verify()).body).toMatchObject({ content: "matches", artifact: "differs" });
    await storage.put(rendered.storage_key, bytes, { overwrite: true });
    expect((await verify()).body).toMatchObject({ content: "matches", artifact: "matches" });
    expect((await verify(`CERT-${YEAR}-9999`)).status).toBe(404);
  }, 120_000);

  test("a course with Issue Certificate off completes with no number and nothing to download", async () => {
    const course = await builtCourse("Fire Drill", { issue_certificate: false });
    await as("ops").post(`/training/courses/${course.training_course_id}/assignments`, { everyone: false, employee_ids: [employeeId("staff")] });
    expect((await finish("staff", course)).status).toBe("completed");
    const place = await enrolmentOf(course.training_course_id, "staff");
    expect(place).toMatchObject({ certificate_number: null, certificate_hash: null, certificate_holder_name: null, certificate_document_id: null });
    await drain();
    expect((await enrolmentOf(course.training_course_id, "staff")).certificate_document_id).toBeNull();
    expect((await as("staff").post(`/training/me/courses/${course.training_course_id}/certificate`)).body.error.code).toBe("NO_CERTIFICATE");
  });

  test("with Proof Required the last Mark Done waits for Add Proof, a link or a file; a course without it asks for none", async () => {
    const course = await builtCourse("Fire Safety", { proof_required: true, proof_prompt: "Paste your certificate link" });
    ids.proofCourse = course.training_course_id;
    await as("ops").post(`/training/courses/${ids.proofCourse}/assignments`, { everyone: false, employee_ids: [employeeId("staff"), employeeId("seller")] });
    const early = await as("staff").post(`/training/me/courses/${ids.proofCourse}/proof`, { url: "https://cert.example.org/1" });
    expect(early.body.error.code).toBe("ITEMS_LEFT");
    const done = await finish("staff", course);
    expect(done).toMatchObject({ status: "in_progress", completed_at: null, proof_required: true, proof_prompt: "Paste your certificate link" });
    expect((await as("staff").post(`/training/me/courses/${ids.proofCourse}/proof`, { url: "http://cert.example.org/1" })).status).toBe(422);
    const res = await as("staff").post(`/training/me/courses/${ids.proofCourse}/proof`, { url: "https://cert.example.org/1" });
    expect(res.body).toMatchObject({ status: "completed", proof_url: "https://cert.example.org/1", certificate_number: `CERT-${YEAR}-0002` });

    // A file: claimed as the person's own proof.
    await finish("seller", course);
    const staged = await as("seller").upload("certificate.pdf", pdf(), "application/pdf");
    const filed = await as("seller").post(`/training/me/courses/${ids.proofCourse}/proof`, { document_id: staged.body.document_id });
    expect(filed.body).toMatchObject({ status: "completed", proof_document_name: "certificate.pdf" });
    const place = await enrolmentOf(ids.proofCourse, "seller");
    expect(await one("SELECT doc_type, subject_employee_id FROM document WHERE document_id = $1", [staged.body.document_id])).toEqual({
      doc_type: "training_proof",
      subject_employee_id: employeeId("seller"),
    });
    expect(place.proof_document_id).toBe(staged.body.document_id);

    // The Code of Conduct asks for none.
    const staffOn = (await as("staff").get(`/training/me/courses/${ids.course}`)).body;
    expect((await as("staff").post(`/training/me/courses/${ids.course}/proof`, { url: "https://x.example.org" })).body.error.code).toBe("PROOF_NOT_ASKED");
    expect(staffOn.status).toBe("in_progress");
  });

  test("an item removed from a published course completes anyone who has done every other item", async () => {
    const course = (await as("staff").get(`/training/me/courses/${ids.course}`)).body;
    for (const item of course.items.slice(0, 3)) await as("staff").post(`/training/me/items/${item.training_item_id}/done`);
    expect((await as("staff").get(`/training/me/courses/${ids.course}`)).body.status).not.toBe("completed");
    const removed = await as("ops").delete(`/training/items/${course.items[3].training_item_id}`);
    expect(removed.body.items).toHaveLength(3);
    expect((await as("staff").get(`/training/me/courses/${ids.course}`)).body).toMatchObject({ status: "completed", certificate_number: `CERT-${YEAR}-0004` });
  });

  test("Withdraw Assignment removes places not started with their tasks; started ones stay without a due date", async () => {
    const course = await builtCourse("Expense Rules");
    ids.withdrawCourse = course.training_course_id;
    const a = await as("ops").post(`/training/courses/${ids.withdrawCourse}/assignments`, {
      everyone: false,
      employee_ids: [employeeId("staff"), employeeId("seller")],
      due_within_days: 10,
    });
    expect(a.body).toMatchObject({ audience_text: "2 people", keep_assigning: false });
    await drain();
    const sellerPlace = await enrolmentOf(ids.withdrawCourse, "seller");
    await as("staff").post(`/training/me/items/${course.items[0].training_item_id}/done`);

    const res = await as("ops").post(`/training/assignments/${a.body.training_assignment_id}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body.withdrawn_at).toEqual(expect.any(String));
    expect(await enrolmentOf(ids.withdrawCourse, "seller")).toBeUndefined();
    expect(await taskOf(sellerPlace.training_enrolment_id)).toMatchObject({ status: "cancelled" });
    const staffPlace = await enrolmentOf(ids.withdrawCourse, "staff");
    expect(staffPlace).toMatchObject({ due_on: null });
    expect((await as("ops").post(`/training/assignments/${a.body.training_assignment_id}/withdraw`)).body.error.code).toBe("ASSIGNMENT_WITHDRAWN");
    const list = await as("ops").get(`/training/courses/${ids.withdrawCourse}/assignments`);
    expect(list.body.data[0]).toMatchObject({ enrolled: 1, people: [expect.objectContaining({ display_name: "Femi Ola" }), expect.objectContaining({ display_name: "Kemi Bassey" })] });
  });

  test("Remind Overdue reminds everyone overdue once a day; the reminder engine reminds before, on and after the due date", async () => {
    const course = await builtCourse("Safeguarding");
    ids.remindCourse = course.training_course_id;
    await as("ops").post(`/training/courses/${ids.remindCourse}/assignments`, { everyone: false, department_ids: [ids.sales], due_within_days: 5 });
    await drain();
    await q("UPDATE training_enrolment SET due_on = $2 WHERE training_course_id = $1 AND employee_id = $3", [ids.remindCourse, day(-2), employeeId("sales")]);

    const res = await as("ops").post(`/training/courses/${ids.remindCourse}/remind`);
    expect(res.body).toEqual({ reminded: 1 });
    expect((await as("ops").post(`/training/courses/${ids.remindCourse}/remind`)).body).toEqual({ reminded: 0 });
    await drain();
    const [notice] = await noticesOf("sales", "training.reminder_due");
    expect(notice).toMatchObject({ title: "Training overdue", entity_type: "training_enrolment" });
    const overdue = await as("ops").get(`/training/courses/${ids.remindCourse}/people?status=overdue`);
    expect(overdue.body.data.map((r) => r.person.display_name)).toEqual(["Tayo Ade"]);
    expect((await as("ops").get("/training/courses?state=published")).body.data.find((r) => r.training_course_id === ids.remindCourse)).toMatchObject({ overdue: 1 });

    // The engine: the seller is due in 3 days, so 08:00 Lagos today is the first step.
    await q("UPDATE training_enrolment SET due_on = $2 WHERE training_course_id = $1 AND employee_id = $3", [ids.remindCourse, day(3), employeeId("seller")]);
    const now = lagos.instant(TODAY, "10:00");
    const tick = await reminders.tick({ db: pool, now });
    expect(tick.fired).toBeGreaterThanOrEqual(1);
    await drain();
    const sellerPlace = await enrolmentOf(ids.remindCourse, "seller");
    const dueNotices = async () =>
      (await noticesOf("seller", "training.reminder_due")).filter((n) => n.entity_id === sellerPlace.training_enrolment_id);
    expect(await dueNotices()).toEqual([expect.objectContaining({ title: "Training due", body: `Safeguarding, due ${day(3).split("-").reverse().join("/")}.` })]);
    // Found once: the next tick adds nothing more for the step.
    await reminders.tick({ db: pool, now: new Date(now.getTime() + 10 * 60_000) });
    await drain();
    expect(await dueNotices()).toHaveLength(1);
    expect((await enrolmentOf(ids.remindCourse, "seller")).reminders_sent).toBe(1);
  });

  test("a joiner in an assigned department is enrolled from their first day, with a task; a leaver's open places close", async () => {
    await make("joiner", "Ada", "Nwosu", "employee", { department: "Sales" });
    await drain();
    const place = await enrolmentOf(ids.course, "joiner");
    expect(place).toMatchObject({ training_assignment_id: expect.any(String) });
    expect(lagos.dateOf(place.due_on)).toBe(day(3));
    expect(await taskOf(place.training_enrolment_id)).toMatchObject({ title: "Complete Code of Conduct", primary_assignee_id: employeeId("joiner") });
    // Named people are never joiners: the withdrawn course's named assignment enrols nobody new.
    expect(await enrolmentOf(ids.withdrawCourse, "joiner")).toBeUndefined();
    // The sweep finds nothing more to do.
    expect(await training.sweep()).toEqual({ enrolled: 0, settled: 0 });

    const closed = await training.closeLeaver(employeeId("joiner"));
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(await enrolmentOf(ids.course, "joiner")).toBeUndefined();
    expect(await taskOf(place.training_enrolment_id)).toMatchObject({ status: "cancelled" });
  });

  test("Archive Course withdraws its assignments: places not started go, those in progress may still finish; it leaves the Library", async () => {
    const course = await builtCourse("Archive Me", { library: true });
    const id = course.training_course_id;
    await as("ops").post(`/training/courses/${id}/assignments`, { everyone: false, department_ids: [ids.sales], due_within_days: 7 });
    await drain();
    await as("sales").post(`/training/me/items/${course.items[0].training_item_id}/done`);
    expect((await as("ops").post(`/training/courses/${id}/archive`, { reason: "Short" })).status).toBe(422);
    const res = await as("ops").post(`/training/courses/${id}/archive`, { reason: "Replaced by the 2027 course" });
    expect(res.body).toMatchObject({ state: "archived", archive_reason: "Replaced by the 2027 course" });
    expect(await enrolmentOf(id, "seller")).toBeUndefined();
    expect(await enrolmentOf(id, "sales")).toMatchObject({ due_on: null });
    expect((await as("staff").get("/training/me?list=library")).body.data.map((r) => r.training_course_id)).not.toContain(id);
    expect((await as("staff").get(`/training/me/courses/${id}`)).status).toBe(404);
    expect((await as("ops").patch(`/training/courses/${id}`, { title: "Renamed Course" })).body.error.code).toBe("COURSE_ARCHIVED");
    const finished = await finish("sales", course);
    expect(finished.status).toBe("completed");
  });

  test("Draft Lesson writes a suggestion from a text and saves nothing; a PDF without text says so", async () => {
    const before = (await one("SELECT count(*)::int AS n FROM training_item")).n;
    const res = await as("ops").post("/training/lesson-with-ai", {
      title: "Handling Personal Data",
      text: "Personal data is anything that names a person. Staff lock their screens and never share passwords with anyone.",
    });
    expect(res.status).toBe(200);
    expect(res.body.lesson_html.length).toBeGreaterThan(20);
    expect((await one("SELECT count(*)::int AS n FROM training_item")).n).toBe(before);
    const run = await one("SELECT purpose, module_key FROM ai_run ORDER BY created_at DESC LIMIT 1");
    expect(run).toEqual({ purpose: "training-lesson-draft", module_key: "knowledge" });

    const staged = await as("ops").upload("scan.pdf", pdf(), "application/pdf");
    const scanned = await as("ops").post("/training/lesson-with-ai", { title: "Scanned", document_id: staged.body.document_id });
    expect(scanned.body.error.code).toBe("NO_TEXT");
    expect((await as("ops").post("/training/lesson-with-ai", { title: "Neither" })).status).toBe(422);
    expect((await as("staff").post("/training/lesson-with-ai", { title: "Mine", text: "x".repeat(50) })).status).toBe(403);
  });

  test("300 people assigned at once: one transaction enrols them, the worker sets 300 tasks and notices", async () => {
    const dept = (await one("INSERT INTO department (code, name) VALUES ('BULK', 'Field Agents') RETURNING department_id")).department_id;
    await q(
      `WITH e AS (
         INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type,
                               work_pattern, start_date, status)
         SELECT 'B' || lpad(n::text, 4, '0'), 'Agent', 'Number ' || n, 'agent' || n || '@bulk.mycity.test', 'Field Agent', $1,
                'full_time', 'on_site', '2026-01-05', 'active'
           FROM generate_series(1, 300) AS n
         RETURNING employee_id, work_email)
       INSERT INTO app_user (employee_id, email, password_hash) SELECT employee_id, work_email, 'not-a-hash' FROM e`,
      [dept],
    );
    const course = await builtCourse("Field Safety");
    const started = Date.now();
    const res = await as("ops").post(`/training/courses/${course.training_course_id}/assignments`, { everyone: false, department_ids: [dept], due_within_days: 14 });
    expect(res.status).toBe(201);
    expect(res.body.enrolled).toBe(300);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect((await q("SELECT count(*)::int AS n FROM task WHERE entity_type = 'training_enrolment' AND title = 'Complete Field Safety'")).rows[0].n).toBe(0);

    await drain();
    const tasks = await one(
      `SELECT count(*)::int AS n, count(DISTINCT t.primary_assignee_id)::int AS people
         FROM training_enrolment te JOIN task t ON t.task_id = te.task_id
        WHERE te.training_course_id = $1`,
      [course.training_course_id],
    );
    expect(tasks).toEqual({ n: 300, people: 300 });
    const notices = await one(
      `SELECT count(*)::int AS n FROM notification n JOIN app_user u ON u.user_id = n.user_id
         JOIN employee e ON e.employee_id = u.employee_id
        WHERE n.event_key = 'training.enrolled' AND e.department_id = $1`,
      [dept],
    );
    expect(notices.n).toBe(300);
    const page = await as("ops").get(`/training/courses/${course.training_course_id}/people`);
    expect(page.body.data).toHaveLength(25);
    expect(page.body.page.total).toBe(300);
  }, 180_000);

  test("My Notes: one note per person and course, theirs alone, saved as typed (§6.13)", async () => {
    const empty = await as("staff").get(`/training/me/courses/${ids.course}/note`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ training_course_id: ids.course, body: "", updated_at: null });

    const first = await as("staff").put(`/training/me/courses/${ids.course}/note`, { body: "Lock the screen before leaving the desk." });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ training_course_id: ids.course, body: "Lock the screen before leaving the desk." });
    expect(first.body.updated_at).toEqual(expect.any(String));
    const second = await as("staff").put(`/training/me/courses/${ids.course}/note`, { body: "Lock the screen.\nReport a lost phone the same day." });
    expect(second.body.body).toBe("Lock the screen.\nReport a lost phone the same day.");
    expect((await q("SELECT count(*)::int AS n FROM training_note WHERE employee_id = $1", [employeeId("staff")])).rows[0].n).toBe(1);

    // Another person on the same course reads their own note, never this one; a manager has no route to it.
    expect((await as("sales").get(`/training/me/courses/${ids.course}/note`)).body.body).toBe("");
    expect((await as("ops").get(`/training/courses/${ids.course}/note`)).status).toBe(404);

    // A course the person may not open is a 404, as the course is; a note past the limit is refused.
    const draft = await as("ops").post("/training/courses", { title: "Still Being Written", summary: "Not yet published" });
    expect((await as("staff").get(`/training/me/courses/${draft.body.training_course_id}/note`)).status).toBe(404);
    expect((await as("staff").put(`/training/me/courses/${draft.body.training_course_id}/note`, { body: "x" })).status).toBe(404);
    const long = await as("staff").put(`/training/me/courses/${ids.course}/note`, { body: "x".repeat(20001) });
    expect(long.status).toBe(422);

    // The audit records that a note was saved and its length, never what it says.
    const saved = await q("SELECT payload FROM event_log WHERE event_key = 'training.note_saved' AND entity_id = $1 ORDER BY occurred_at", [ids.course]);
    expect(saved.rows.map((r) => r.payload.characters)).toEqual([40, 50]);
    expect(JSON.stringify(saved.rows)).not.toContain("Lock the screen");
  });

  test("⌘K and Praxis AI: builders find courses; everyone finds their own and the Library's", async () => {
    const types = (res) => res.body.groups.map((g) => g.type);
    const titles = (res, type) => (res.body.groups.find((g) => g.type === type) || { items: [] }).items.map((i) => i.title);
    const ops = await as("ops").get("/search?q=Conduct");
    expect(ops.status).toBe(200);
    expect(titles(ops, "training_course")).toContain("Code of Conduct");
    const staff = await as("staff").get("/search?q=Conduct");
    expect(types(staff)).not.toContain("training_course");
    expect(titles(staff, "training_enrolment")).toContain("Code of Conduct");
    // A course they are not on, and not in the Library, is not theirs to find.
    expect(titles(await as("seller").get("/search?q=Expense"), "training_enrolment")).toEqual([]);
  });
});
