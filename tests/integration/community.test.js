"use strict";
/**
 * Staff Community and Announcements, end to end (docs/guides/community.md): the real
 * migrations on a throwaway database, the whole app through HTTP, the outbox drained as
 * the worker would. Every response is checked against its contract by route().
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/community
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const realtime = require("../../src/services/realtime/emitter");
const community = require("../../src/modules/community/community.service");
const lagos = require("../../src/shared/time/lagos");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));
const queues = require("../../src/jobs/queues");

// Link cards never reach the internet in a test: the page's card is the test's own.
jest.mock("../../src/services/web/page-card", () => ({
  ...jest.requireActual("../../src/services/web/page-card"),
  fetchCard: jest.fn(),
}));
const pageCard = require("../../src/services/web/page-card");
const links = require("../../src/modules/community/community.links");
const mediaDerive = require("../../src/jobs/handlers/media-derive");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const PASSWORD = "Brand-new9Pass";

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A short WebM header: enough for the type sniffer to call it audio. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x42\x82\x84webm"), Buffer.alloc(64)]);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** A small PDF of `pages` A4 pages, each with a line of text in the standard Helvetica. */
function pdfOf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let i = 0; i < pages; i += 1) {
    const text = `BT /F1 24 Tf 72 760 Td (Page ${i + 1}) Tj ET`;
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    const content = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describeDb("Staff Community against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.41.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };

  async function tokenOf(email) {
    const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
      del: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const today = lagos.today();
    const sample = (first, last, email, job, extra = {}) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2024-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
      ...extra,
    });
    await tx(async (client) => {
      people.ceo = await createAdmin(
        client,
        { employee: sample("Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer"), role_code: "management", is_ceo: true },
        PASSWORD,
      );
      people.bola = await createAdmin(
        client,
        {
          employee: sample("Bola", "Ade", "bola@mycity.test", "Content Associate", {
            date_of_birth: `1994-${today.slice(5)}`,
          }),
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD,
      );
      people.tunde = await createAdmin(
        client,
        {
          employee: sample("Tunde", "Ola", "tunde@mycity.test", "Studio Manager", {
            start_date: `${Number(today.slice(0, 4)) - 3}-${today.slice(5)}`,
          }),
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD,
        { allowAdditional: true },
      );
    });
    await drain();
    for (const who of ["ceo", "bola", "tunde"]) tokens[who] = await tokenOf(`${who}@mycity.test`);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  const channelsOf = async (who) => (await as(who).get("/community/channels")).body.data;
  const general = async (who) => (await channelsOf(who)).find((c) => c.name === "general");

  test("signed out is a 401", async () => {
    expect((await request(app).get("/api/v1/community/channels")).status).toBe(401);
  });

  test("opening Community makes #general and #announcements, pinned, and joins the person to both", async () => {
    const list = await as("bola").get("/community/channels");
    expect(list.status).toBe(200);
    const names = list.body.data.map((c) => c.name);
    expect(names.slice(0, 2).sort()).toEqual(["announcements", "general"]);
    const ann = list.body.data.find((c) => c.name === "announcements");
    expect(ann).toMatchObject({ pinned: true, post_policy: "people_ceo", can_post: false });
    expect(list.body.data.find((c) => c.name === "general")).toMatchObject({ can_post: true });
    // Nobody posts straight into #announcements, the CEO included: announcements come from the tab.
    expect((await channelsOf("ceo")).find((c) => c.name === "announcements").can_post).toBe(false);
    await channelsOf("tunde");
  });

  test("a channel: created with members, unique names, admins manage members, outsiders get 404", async () => {
    const made = await as("bola").post("/community/channels").send({
      name: "studio-crew",
      description: "Shoots and edits",
      member_ids: [people.tunde.employee.employee_id],
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "studio-crew", members: 2, is_admin: true, can_post: true, post_policy: "everyone" });
    const id = made.body.community_channel_id;

    const again = await as("tunde").post("/community/channels").send({ name: "studio-crew" });
    expect(again.status).toBe(409);
    expect(again.body.error.fields.name).toEqual(["Name already taken"]);
    expect((await as("tunde").post("/community/channels").send({ name: "Bad Name" })).status).toBe(422);

    const members = await as("tunde").get(`/community/channels/${id}/members`);
    expect(members.body.page.total).toBe(2);
    expect(members.body.data[0]).toMatchObject({ member_role: "admin" });

    // Only an admin edits members.
    expect((await as("tunde").post(`/community/channels/${id}/members`).send({ member_ids: [people.ceo.employee.employee_id] })).status).toBe(403);
    expect((await as("ceo").get(`/community/channels/${id}`)).status).toBe(404);
    expect((await as("ceo").get(`/community/channels/${id}/messages`)).status).toBe(404);

    const added = await as("bola").post(`/community/channels/${id}/members`).send({ member_ids: [people.ceo.employee.employee_id] });
    expect(added.status).toBe(200);
    expect(added.body.members).toBe(3);
    expect((await as("bola").del(`/community/channels/${id}/members/${people.ceo.user.user_id}`)).status).toBe(204);
    expect((await as("ceo").get(`/community/channels/${id}`)).status).toBe(404);
  });

  test("admins are chosen in Edit Members: only an admin makes one, and the last admin cannot step down", async () => {
    const made = await as("bola").post("/community/channels").send({ name: "dev-hub", member_ids: [people.tunde.employee.employee_id], post_policy: "admins" });
    const id = made.body.community_channel_id;
    const role = (who, userId, member_role) => as(who).put(`/community/channels/${id}/members/${userId}/role`).send({ member_role });

    expect((await role("tunde", people.tunde.user.user_id, "admin")).status).toBe(403);
    expect((await as("tunde").post(`/community/channels/${id}/messages`).send({ message_type: "text", body: "hi" })).status).toBe(403);

    const up = await role("bola", people.tunde.user.user_id, "admin");
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ user_id: people.tunde.user.user_id, member_role: "admin", person: { display_name: "Tunde Ola" } });
    expect((await as("tunde").get(`/community/channels/${id}`)).body).toMatchObject({ is_admin: true, can_post: true });

    // Two admins: one may step down; then the one left may not.
    expect((await role("tunde", people.bola.user.user_id, "member")).status).toBe(200);
    const last = await role("tunde", people.tunde.user.user_id, "member");
    expect(last.status).toBe(422);
    expect(last.body.error.code).toBe("LAST_ADMIN");
    expect((await role("tunde", people.ceo.user.user_id, "admin")).status).toBe(404);

    const g = await general("bola");
    expect((await as("bola").put(`/community/channels/${g.community_channel_id}/members/${people.tunde.user.user_id}/role`).send({ member_role: "admin" })).status).toBe(422);
  });

  test("posting text, an image and a voice note in a channel; unread counts; realtime to members", async () => {
    const ch = (await channelsOf("bola")).find((c) => c.name === "studio-crew");
    const id = ch.community_channel_id;

    const text = await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "text", body: "Call time is 08:00" });
    expect(text.status).toBe(201);
    expect(text.body).toMatchObject({ message_type: "text", mine: true, body: "Call time is 08:00", status: null });
    await drain();
    expect(realtime.toUser).toHaveBeenCalledWith(people.tunde.user.user_id, "community.message", expect.objectContaining({ community_channel_id: id }));

    const img = await as("bola").post(`/community/channels/${id}/media`).attach("file", PNG, "set.png");
    expect(img.status).toBe(201);
    // The file as a bubble draws it (MediaRef): its shape, and the sizes made so far (none for a photo this small).
    expect(img.body).toEqual({
      document_id: expect.any(String),
      file_name: "set.png",
      size_bytes: expect.any(Number),
      mime_type: "image/png",
      width: 1,
      height: 1,
      page_count: null,
      duration_ms: null,
      variants: [],
    });
    const posted = await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "file", document_id: img.body.document_id });
    expect(posted.status).toBe(201);
    expect(posted.body.message_type).toBe("image");
    expect(posted.body.document).toMatchObject({ document_id: img.body.document_id, mime_type: "image/png" });

    const audio = await as("tunde").post(`/community/channels/${id}/media`).attach("file", WEBM, "note.webm");
    expect(audio.status).toBe(201);
    const voice = await as("tunde").post(`/community/channels/${id}/messages`).send({
      message_type: "audio",
      document_id: audio.body.document_id,
      duration_s: 12,
    });
    expect(voice.status).toBe(201);
    expect(voice.body).toMatchObject({ message_type: "audio", duration_s: 12 });

    // A file another channel's member uploaded cannot be posted here.
    expect(
      (await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "audio", document_id: audio.body.document_id, duration_s: 3 })).status,
    ).toBe(422);
    // The voice note is readable by members only.
    expect((await as("bola").get(`/documents/${audio.body.document_id}/content`)).status).toBe(200);
    expect((await as("ceo").get(`/documents/${audio.body.document_id}/content`)).status).toBe(404);

    // Sending is reading: Tunde's own post moved his pointer; Bola has one unread, the voice note.
    expect((await channelsOf("tunde")).find((c) => c.name === "studio-crew").unread).toBe(0);
    const bola = (await channelsOf("bola")).find((c) => c.name === "studio-crew");
    expect(bola).toMatchObject({ unread: 1, last_text: "Voice note" });
    expect((await as("bola").post(`/community/channels/${id}/read`).send({})).status).toBe(204);
    expect((await channelsOf("bola")).find((c) => c.name === "studio-crew").unread).toBe(0);

    const page = await as("bola").get(`/community/channels/${id}/messages`);
    expect(page.body.data.map((m) => m.message_type)).toEqual(["text", "image", "audio"]);
    const found = await as("bola").get(`/community/channels/${id}/messages?q=call time`);
    expect(found.body.data).toHaveLength(1);
  });

  test("a recognition posts to #general from wherever it was started, with a written note when left blank", async () => {
    const res = await as("bola").post("/community/recognitions").send({ to_employee_id: people.tunde.employee.employee_id });
    expect(res.status).toBe(201);
    const g = await general("bola");
    expect(res.body.community_channel_id).toBe(g.community_channel_id);
    expect(res.body.message_type).toBe("recognition");
    expect(res.body.recognition).toMatchObject({ to: { employee_id: people.tunde.employee.employee_id }, count: 0 });
    expect(res.body.body).toMatch(/^Thank you/);
    const row = await one("SELECT note_written_by_system FROM peer_recognition WHERE community_message_id = $1", [res.body.community_message_id]);
    expect(row.note_written_by_system).toBe(true);

    expect((await as("bola").post("/community/recognitions").send({ to_employee_id: people.bola.employee.employee_id })).status).toBe(422);

    const up = await as("ceo").post(`/community/messages/${res.body.community_message_id}/reactions`).send({});
    expect(up.body.recognition).toMatchObject({ count: 1, mine: true });
    const down = await as("ceo").post(`/community/messages/${res.body.community_message_id}/reactions`).send({});
    expect(down.body.recognition).toMatchObject({ count: 0, mine: false });

    await drain();
    const told = await one(
      "SELECT title FROM notification WHERE user_id = $1 AND event_key = 'recognition.posted'",
      [people.tunde.user.user_id],
    );
    expect(told.title).toBe("Bola Ade recognised you");
  });

  test("a poll: one vote each, moved by voting again, taken back by voting the same", async () => {
    const g = await general("tunde");
    const lunch = { message_type: "poll", body: "Team lunch on Friday?", options: ["Jollof Joint", "Order in"] };
    // In #general only moderators (People and the CEO) start a poll.
    const refused = await as("tunde").post(`/community/channels/${g.community_channel_id}/messages`).send(lunch);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("CANNOT_POLL");
    const poll = await as("ceo").post(`/community/channels/${g.community_channel_id}/messages`).send(lunch);
    expect(poll.status).toBe(201);
    const id = poll.body.community_message_id;
    let v = await as("bola").post(`/community/messages/${id}/vote`).send({ option_index: 0 });
    expect(v.body.poll).toMatchObject({ my_vote: 0, options: [{ votes: 1 }, { votes: 0 }] });
    v = await as("bola").post(`/community/messages/${id}/vote`).send({ option_index: 1 });
    expect(v.body.poll).toMatchObject({ my_vote: 1, options: [{ votes: 0 }, { votes: 1 }] });
    v = await as("bola").post(`/community/messages/${id}/vote`).send({ option_index: 1 });
    expect(v.body.poll.my_vote).toBeNull();
    expect((await as("bola").post(`/community/messages/${id}/vote`).send({ option_index: 3 })).status).toBe(422);
  });

  test("edit, delete and close: the author's text for 15 minutes, a poll before its first vote, moderators delete", async () => {
    const made = await as("bola").post("/community/channels").send({ name: "edit-desk", member_ids: [people.tunde.employee.employee_id, people.ceo.employee.employee_id] });
    const id = made.body.community_channel_id;
    const post = (who, body) => as(who).post(`/community/channels/${id}/messages`).send(body);

    // Text: the author edits within 15 minutes, nobody else does, and not after.
    const text = await post("tunde", { message_type: "text", body: "Shoot at 9" });
    expect(text.body).toMatchObject({ can_edit: true, can_delete: true, edited_at: null });
    const edited = await as("tunde").put(`/community/messages/${text.body.community_message_id}`).send({ body: "Shoot at 10" });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe("Shoot at 10");
    expect(edited.body.edited_at).not.toBeNull();
    expect((await as("ceo").put(`/community/messages/${text.body.community_message_id}`).send({ body: "x" })).status).toBe(403);
    await q("UPDATE community_message SET sent_at = now() - interval '16 minutes' WHERE community_message_id = $1", [text.body.community_message_id]);
    const late = await as("tunde").put(`/community/messages/${text.body.community_message_id}`).send({ body: "Shoot at 11" });
    expect(late.status).toBe(409);
    expect(late.body.error.fields.body).toEqual(["Too late to edit"]);

    // A poll: edited until its first vote, then only closed; a closed poll takes no votes.
    const poll = await post("tunde", { message_type: "poll", body: "Studio day?", options: ["Tue", "Wed"] });
    const pid = poll.body.community_message_id;
    const changed = await as("tunde").put(`/community/messages/${pid}`).send({ body: "Studio day next week?", options: ["Tue", "Wed", "Thu"] });
    expect(changed.body.poll).toMatchObject({ question: "Studio day next week?", closed: false });
    expect(changed.body.poll.options).toHaveLength(3);
    await as("ceo").post(`/community/messages/${pid}/vote`).send({ option_index: 2 });
    expect((await as("tunde").put(`/community/messages/${pid}`).send({ body: "Other?" })).status).toBe(409);
    expect((await as("ceo").post(`/community/messages/${pid}/close`).send({})).status).toBe(403);
    const closed = await as("bola").post(`/community/messages/${pid}/close`).send({});
    expect(closed.body.poll).toMatchObject({ closed: true, options: [{ votes: 0 }, { votes: 0 }, { votes: 1 }] });
    expect(closed.body.can_close).toBe(false);
    expect((await as("ceo").post(`/community/messages/${pid}/vote`).send({ option_index: 0 })).status).toBe(409);

    // Delete: the author, or the channel's admin; a member may not delete another's.
    expect((await as("ceo").del(`/community/messages/${text.body.community_message_id}`)).status).toBe(403);
    expect((await as("bola").del(`/community/messages/${text.body.community_message_id}`)).status).toBe(204);
    const page = await as("tunde").get(`/community/channels/${id}/messages`);
    const gone = page.body.data.find((m) => m.community_message_id === text.body.community_message_id);
    expect(gone).toMatchObject({ deleted: true, body: null, can_edit: false, can_delete: false });
    expect((await as("bola").del(`/community/messages/${text.body.community_message_id}`)).status).toBe(404);

    // Celebrations by hand: the channel's admins only.
    const bday = { message_type: "birthday", subject_employee_id: people.ceo.employee.employee_id };
    expect((await post("tunde", bday)).status).toBe(403);
    expect((await post("bola", bday)).status).toBe(201);
    // A hand-posted anniversary carries its years, as the 05:00 ones do.
    const anniv = await post("bola", { message_type: "anniversary", subject_employee_id: people.tunde.employee.employee_id });
    expect(anniv.status).toBe(201);
    expect(anniv.body.celebration).toMatchObject({ years: 3 });
  });

  test("a deleted recognition leaves the counts; People and the CEO moderate #general; an announcement's post stays", async () => {
    const rec = await as("tunde").post("/community/recognitions").send({ to_employee_id: people.bola.employee.employee_id, message: "Great edit" });
    const rid = rec.body.community_message_id;
    expect((await one("SELECT count(*)::int AS n FROM peer_recognition WHERE community_message_id = $1", [rid])).n).toBe(1);
    expect((await as("bola").del(`/community/messages/${rid}`)).status).toBe(403);
    expect((await as("ceo").del(`/community/messages/${rid}`)).status).toBe(204);
    expect((await one("SELECT count(*)::int AS n FROM peer_recognition WHERE community_message_id = $1", [rid])).n).toBe(0);

    const g = await general("ceo");
    expect(g).toMatchObject({ can_moderate: true, can_poll: true });
    expect(await general("bola")).toMatchObject({ can_moderate: false, can_poll: false, can_post: true });

    const made = await as("ceo").post("/community/announcements").send({ title: "Office closed Monday", body: "Public holiday." });
    const ann = await one("SELECT community_message_id FROM announcement WHERE announcement_id = $1", [made.body.announcement_id]);
    const refused = await as("ceo").del(`/community/messages/${ann.community_message_id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("ANNOUNCEMENT_POST");
  });

  test("a conversation with oneself: offered by New Message only, named for the caller, one member, no ticks", async () => {
    expect((await as("bola").get("/community/people")).body.data.map((p) => p.display_name)).not.toContain("Bola Ade");
    const mine = await as("bola").get("/community/people?with_self=true");
    expect(mine.body.data.map((p) => p.display_name)).toContain("Bola Ade");

    const me = await as("bola").post("/community/direct").send({ employee_id: people.bola.employee.employee_id });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ is_self: true, person: { display_name: "Bola Ade" } });
    const again = await as("bola").post("/community/direct").send({ employee_id: people.bola.employee.employee_id });
    expect(again.body.community_channel_id).toBe(me.body.community_channel_id);
    expect((await one("SELECT count(*)::int AS n FROM community_member WHERE community_channel_id = $1", [me.body.community_channel_id])).n).toBe(1);

    const note = await as("bola").post(`/community/channels/${me.body.community_channel_id}/messages`).send({ message_type: "text", body: "Buy printer ink" });
    expect(note.body.status).toBeNull();
    const list = await as("bola").get("/community/direct");
    expect(list.body.data.find((c) => c.community_channel_id === me.body.community_channel_id)).toMatchObject({ is_self: true, last_text: "Buy printer ink" });

    // A conversation with a colleague is still found as before, not the one with oneself.
    const pair = await as("bola").post("/community/direct").send({ employee_id: people.tunde.employee.employee_id });
    expect(pair.body).toMatchObject({ is_self: false });
    expect(pair.body.community_channel_id).not.toBe(me.body.community_channel_id);
    // Recognising oneself stays refused (A19 is peer to peer).
    expect((await as("bola").post("/community/recognitions").send({ to_employee_id: people.bola.employee.employee_id })).status).toBe(422);
  });

  test("pinning is each person's own, at most 3, under the two company channels; muting stays per person", async () => {
    const names = ["pin-a", "pin-b", "pin-c", "pin-d"];
    const ids = {};
    for (const name of names) ids[name] = (await as("tunde").post("/community/channels").send({ name, member_ids: [people.bola.employee.employee_id] })).body.community_channel_id;
    const pin = (who, id, pinned = true) => as(who).put(`/community/channels/${id}/pin`).send({ pinned });

    for (const name of ["pin-a", "pin-b", "pin-c"]) expect((await pin("bola", ids[name])).status).toBe(204);
    const full = await pin("bola", ids["pin-d"]);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("PIN_LIMIT");

    const list = await channelsOf("bola");
    expect(list.slice(2, 5).map((c) => c.name)).toEqual(["pin-c", "pin-b", "pin-a"]);
    expect(list.filter((c) => c.pin_locked).map((c) => c.name).sort()).toEqual(["announcements", "general"]);
    expect(list.filter((c) => c.pinned && !c.pin_locked).map((c) => c.name)).toEqual(["pin-c", "pin-b", "pin-a"]);
    // Tunde pinned nothing: Bola's pins are Bola's.
    expect((await channelsOf("tunde")).filter((c) => c.pinned && !c.pin_locked)).toEqual([]);

    // The company channels stay pinned for everyone.
    const g = await general("bola");
    expect((await pin("bola", g.community_channel_id, false)).status).toBe(422);

    // Unpin one, and a direct conversation can take the place.
    expect((await pin("bola", ids["pin-a"], false)).status).toBe(204);
    const dm = await as("bola").post("/community/direct").send({ employee_id: people.tunde.employee.employee_id });
    expect((await pin("bola", dm.body.community_channel_id)).status).toBe(204);
    const convs = await as("bola").get("/community/direct");
    expect(convs.body.data[0]).toMatchObject({ community_channel_id: dm.body.community_channel_id, pinned: true });

    // Muting is per person too.
    expect((await as("bola").post(`/community/channels/${ids["pin-b"]}/mute`).send({ muted: true })).status).toBe(204);
    expect((await channelsOf("bola")).find((c) => c.name === "pin-b").muted).toBe(true);
    expect((await channelsOf("tunde")).find((c) => c.name === "pin-b").muted).toBe(false);
    // And it can be undone: a channel muted for good must read as muted, or the screen could never unmute it.
    expect((await as("bola").post(`/community/channels/${ids["pin-b"]}/mute`).send({ muted: false })).status).toBe(204);
    expect((await channelsOf("bola")).find((c) => c.name === "pin-b").muted).toBe(false);
  });

  test("direct messages: one conversation per pair, ticks from sent to delivered to read, private to the two", async () => {
    const opened = await as("bola").post("/community/direct").send({ employee_id: people.tunde.employee.employee_id });
    expect(opened.status).toBe(200);
    const again = await as("tunde").post("/community/direct").send({ employee_id: people.bola.employee.employee_id });
    expect(again.body.community_channel_id).toBe(opened.body.community_channel_id);
    const id = opened.body.community_channel_id;

    const sent = await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "text", body: "Are the permits in?" });
    expect(sent.body.status).toBe("sent");
    await drain();
    const told = await one("SELECT title, body FROM notification WHERE user_id = $1 AND event_key = 'direct_message.sent'", [people.tunde.user.user_id]);
    expect(told).toMatchObject({ title: "Bola Ade", body: "Are the permits in?" });

    const list = await as("tunde").get("/community/direct?unread=true");
    expect(list.body.data[0]).toMatchObject({ community_channel_id: id, unread: 1, last_text: "Are the permits in?", last_mine: false });

    await as("tunde").post(`/community/channels/${id}/delivered`).send({ up_to: new Date().toISOString() });
    let mine = (await as("bola").get(`/community/channels/${id}/messages`)).body.data.at(-1);
    expect(mine.status).toBe("delivered");
    await as("tunde").post(`/community/channels/${id}/read`).send({});
    mine = (await as("bola").get(`/community/channels/${id}/messages`)).body.data.at(-1);
    expect(mine.status).toBe("read");

    // Nobody else reads it, the CEO included.
    expect((await as("ceo").get(`/community/channels/${id}/messages`)).status).toBe(404);

    // Muted: no notification for the next message.
    expect((await as("tunde").post(`/community/channels/${id}/mute`).send({ muted: true })).status).toBe(204);
    await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "text", body: "Ping" });
    await drain();
    const count = await one("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND event_key = 'direct_message.sent'", [people.tunde.user.user_id]);
    expect(count.n).toBe(1);

    // Anyone can find a colleague to message, without the People grant.
    const found = await as("bola").get("/community/people?q=tunde");
    expect(found.status).toBe(200);
    expect(found.body.data.map((p) => p.display_name)).toEqual(["Tunde Ola"]);
    // Nobody is offered themselves: the list leaves the caller out.
    const everyone = await as("bola").get("/community/people");
    expect(everyone.body.data.map((p) => p.display_name)).not.toContain("Bola Ade");
    expect(everyone.body.page.total).toBe(2);
    // Without a photo a colleague carries photo_url null, and the picker shows initials.
    expect(everyone.body.data.every((p) => p.photo_url === null)).toBe(true);

    const card = await as("bola").get(`/community/people/${people.tunde.employee.employee_id}/card`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ work_email: "tunde@mycity.test", shared_channels: expect.arrayContaining(["general", "studio-crew"]) });
  });

  test("announcements: People and the CEO only; published to #announcements with read tracking; scheduled ones wait", async () => {
    expect((await as("bola").get("/community/announcements")).status).toBe(403);
    expect((await as("bola").post("/community/announcements").send({ title: "Hello", body: "World" })).status).toBe(403);

    const made = await as("ceo").post("/community/announcements").send({ title: "Saturday hours", body: "Saturdays are 09:00 to 15:00." });
    expect(made.status).toBe(201);
    // The poster, never told of their own post, has read it.
    expect(made.body).toMatchObject({ status: "published", audience: { kind: "all" }, audience_size: 3, reads: 1, urgency: "normal" });
    await drain();
    const told = await one("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'announcement.published' AND title = 'Saturday hours'", [people.bola.user.user_id]);
    expect(told).toBeTruthy();

    const ann = (await channelsOf("bola")).find((c) => c.name === "announcements");
    const msgs = await as("bola").get(`/community/channels/${ann.community_channel_id}/messages`);
    expect(msgs.body.data.at(-1)).toMatchObject({ message_type: "announcement", announcement: { title: "Saturday hours" } });
    expect((await as("bola").post(`/community/channels/${ann.community_channel_id}/messages`).send({ message_type: "text", body: "hi" })).status).toBe(403);
    // Nothing is posted straight into #announcements, the CEO included; it has no composer.
    expect((await as("ceo").post(`/community/channels/${ann.community_channel_id}/messages`).send({ message_type: "text", body: "hi" })).status).toBe(403);
    expect(ann.can_post).toBe(false);

    // The tab's figures come from the server; the audience is the active staff, not a past announcement's.
    const figures = await as("ceo").get("/community/announcements/stats");
    expect(figures.status).toBe(200);
    expect(figures.body).toMatchObject({ audience: 3 });
    expect(figures.body.published).toBeGreaterThanOrEqual(1);
    expect((await as("bola").get("/community/announcements/stats")).status).toBe(403);

    const reads = await as("ceo").get(`/community/announcements/${made.body.announcement_id}/reads?read=read`);
    expect(reads.body.data.map((r) => r.person.display_name)).toEqual(["Bola Ade", "Amaka Eze"]);
    const remind = await as("ceo").post(`/community/announcements/${made.body.announcement_id}/remind`).send({});
    expect(remind.body).toEqual({ reminded: 1 });
    expect((await as("ceo").post(`/community/announcements/${made.body.announcement_id}/remind`).send({})).status).toBe(429);

    const later = new Date(Date.now() + 3600_000).toISOString();
    const sched = await as("ceo").post("/community/announcements").send({ title: "Q4 reviews", body: "Open on Monday.", publish_at: later });
    expect(sched.body).toMatchObject({ status: "scheduled", published_at: null });
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith(
      "announcement-publish",
      "release",
      { announcement_id: sched.body.announcement_id },
      expect.objectContaining({ jobId: `announcement-publish-${sched.body.announcement_id}` }),
    );
    expect((await as("ceo").post("/community/announcements").send({ title: "Past", body: "Gone", publish_at: new Date(Date.now() - 60_000).toISOString() })).status).toBe(422);

    await q("UPDATE announcement SET publish_at = now() - interval '1 minute' WHERE announcement_id = $1", [sched.body.announcement_id]);
    const done = await require("../../src/modules/announcements/announcements.service").releaseDue();
    expect(done.released).toBe(1);
    const list = await as("ceo").get("/community/announcements");
    expect(list.body.data.find((a) => a.title === "Q4 reviews").status).toBe("published");
  });

  test("an urgent announcement: red to its audience, open until each person acknowledges, on the card or the urgent bar", async () => {
    const made = await as("ceo").post("/community/announcements").send({ title: "Fire drill at 11", body: "Leave by the east stairs.", urgency: "urgent" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ urgency: "urgent", reads: 1, audience_size: 3 });
    const id = made.body.announcement_id;
    await drain();
    const noticeOf = (who) =>
      one("SELECT * FROM notification WHERE user_id = $1 AND event_key = 'announcement.published' AND entity_id = $2", [people[who].user.user_id, id]);
    const bola = await noticeOf("bola");
    expect(bola).toMatchObject({ urgency: "urgent", acknowledge_required: true, body: "Urgent. Acknowledge it in #announcements." });
    expect(await noticeOf("ceo")).toBeUndefined(); // never told of their own post

    // Opening #announcements is not enough: the card still asks, and the notice stays in the bar.
    const ann = (await channelsOf("bola")).find((c) => c.name === "announcements");
    const msgs = await as("bola").get(`/community/channels/${ann.community_channel_id}/messages`);
    expect(msgs.body.data.find((m) => m.announcement && m.announcement.announcement_id === id).announcement).toEqual({
      announcement_id: id,
      title: "Fire drill at 11",
      urgency: "urgent",
      in_audience: true,
      acknowledged_at: null,
    });
    expect((await as("bola").get("/notifications/urgent")).body.data.map((n) => n.notification_id)).toContain(bola.notification_id);
    expect((await as("ceo").get(`/community/announcements/${id}/reads?read=not_read`)).body.data.map((r) => r.person.display_name).sort()).toEqual(["Bola Ade", "Tunde Ola"]);

    // Bola presses Acknowledge on the card: the reads row and the notice close together.
    expect((await as("bola").post(`/community/announcements/${id}/acknowledge`).send({})).status).toBe(204);
    expect((await as("bola").post(`/community/announcements/${id}/acknowledge`).send({})).status).toBe(204);
    expect((await noticeOf("bola")).acknowledged_at).not.toBeNull();
    expect((await as("bola").get("/notifications/urgent")).body.data.map((n) => n.notification_id)).not.toContain(bola.notification_id);
    const after = await as("bola").get(`/community/channels/${ann.community_channel_id}/messages`);
    expect(after.body.data.find((m) => m.announcement && m.announcement.announcement_id === id).announcement.acknowledged_at).not.toBeNull();

    // Tunde presses it on the urgent bar instead: the announcement records it once the event is handled.
    const tunde = await noticeOf("tunde");
    const pressed = await as("tunde").post(`/notifications/${tunde.notification_id}/acknowledge`).send({});
    expect(pressed.status).toBe(200);
    expect(pressed.body).toMatchObject({ notification_id: tunde.notification_id, urgency: "urgent", acknowledge_required: true });
    expect(pressed.body.acknowledged_at).not.toBeNull();
    await drain();
    const reads = await as("ceo").get(`/community/announcements/${id}/reads`);
    expect(reads.body.data.every((r) => r.acknowledged_at)).toBe(true);
    expect((await as("ceo").get("/community/announcements")).body.data.find((a) => a.announcement_id === id)).toMatchObject({ reads: 3 });

    // Only an urgent announcement takes Acknowledge, and only from its audience.
    const plain = await as("ceo").post("/community/announcements").send({ title: "Lunch", body: "On us." });
    expect((await as("bola").post(`/community/announcements/${plain.body.announcement_id}/acknowledge`).send({})).status).toBe(422);
  });

  test("an important announcement is amber and reminds whoever has not opened it once, 4 hours later", async () => {
    const svc = require("../../src/modules/announcements/announcements.service");
    queues.enqueue.mockClear();
    const made = await as("ceo").post("/community/announcements").send({ title: "New leave form", body: "Use it from Monday.", urgency: "important" });
    const id = made.body.announcement_id;
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith(
      "announcement-publish",
      "remind",
      { announcement_id: id },
      expect.objectContaining({ delay: 4 * 60 * 60 * 1000, jobId: `announcement-remind-${id}` }),
    );
    const told = await one("SELECT urgency, acknowledge_required FROM notification WHERE user_id = $1 AND entity_id = $2", [people.bola.user.user_id, id]);
    expect(told).toEqual({ urgency: "important", acknowledge_required: false });

    const ann = (await channelsOf("bola")).find((c) => c.name === "announcements");
    await as("bola").get(`/community/channels/${ann.community_channel_id}/messages`); // Bola opens it
    const job = require("../../src/jobs/handlers/announcement-publish");
    expect(await job({ name: "remind", data: { announcement_id: id } })).toEqual({ announcement_id: id, reminded: 1 });
    await drain();
    expect(await one("SELECT count(*)::int AS n FROM notification WHERE event_key = 'announcement.reminded' AND entity_id = $1", [id])).toEqual({ n: 1 });
    // A normal one has no reminder of its own.
    const plain = await as("ceo").post("/community/announcements").send({ title: "Cake", body: "In the kitchen." });
    expect(await svc.remindUnread(plain.body.announcement_id)).toEqual({ reminded: 0 });
  });

  test("a scheduled announcement is edited or cancelled until it goes out; a stale release does nothing", async () => {
    const svc = require("../../src/modules/announcements/announcements.service");
    const at = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
    const sched = await as("ceo").post("/community/announcements").send({ title: "Town hall", body: "Friday at 4.", publish_at: at(60) });
    const id = sched.body.announcement_id;
    expect((await as("bola").put(`/community/announcements/${id}`).send({ title: "x", body: "y", audience: { kind: "all" }, publish_at: at(90) })).status).toBe(403);
    expect((await as("ceo").put(`/community/announcements/${id}`).send({ title: "Town hall", body: "Friday at 4.", audience: { kind: "all" }, publish_at: at(-1) })).status).toBe(422);

    queues.enqueue.mockClear();
    const moved = await as("ceo").put(`/community/announcements/${id}`).send({ title: "Town hall moved", body: "Monday at 4.", audience: { kind: "all" }, publish_at: at(120) });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ status: "scheduled", title: "Town hall moved", body: "Monday at 4." });
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith("announcement-publish", "release", { announcement_id: id }, expect.objectContaining({ jobId: expect.stringMatching(new RegExp(`^announcement-publish-${id}-`)) }));

    // The job queued for the first time runs: it is not due yet, so nothing goes out.
    expect((await svc.release(id)).status).toBe("scheduled");

    const cancelled = await as("ceo").post(`/community/announcements/${id}/cancel`).send({});
    expect(cancelled.body.status).toBe("cancelled");
    await q("UPDATE announcement SET publish_at = now() - interval '1 minute' WHERE announcement_id = $1", [id]);
    expect((await svc.release(id)).status).toBe("cancelled");
    expect((await as("ceo").get("/community/announcements")).body.data.find((a) => a.announcement_id === id)).toBeUndefined();
    expect((await as("ceo").post(`/community/announcements/${id}/cancel`).send({})).status).toBe(404);

    const live = await as("ceo").post("/community/announcements").send({ title: "Now", body: "Now." });
    expect((await as("ceo").put(`/community/announcements/${live.body.announcement_id}`).send({ title: "Now", body: "Edited", audience: { kind: "all" }, publish_at: at(30) })).status).toBe(409);
    expect((await as("ceo").post(`/community/announcements/${live.body.announcement_id}/cancel`).send({})).status).toBe(409);
  });

  test("celebrations post today's birthday and anniversary cards to #general once, and Celebrate counts", async () => {
    const first = await community.postCelebrations(lagos.today());
    expect(first).toMatchObject({ due: 2, posted: 2 });
    const second = await community.postCelebrations(lagos.today());
    expect(second.posted).toBe(0);

    const g = await general("ceo");
    const page = await as("ceo").get(`/community/channels/${g.community_channel_id}/messages`);
    const bday = page.body.data.find((m) => m.message_type === "birthday");
    const anniv = page.body.data.find((m) => m.message_type === "anniversary");
    expect(bday).toMatchObject({ author: null, celebration: { subject: { display_name: "Bola Ade" }, count: 0 } });
    expect(anniv.celebration).toMatchObject({ subject: { display_name: "Tunde Ola" }, years: 3 });

    const c = await as("ceo").post(`/community/messages/${bday.community_message_id}/reactions`).send({});
    expect(c.body.celebration).toMatchObject({ count: 1, mine: true, fans: [{ display_name: "Amaka Eze" }] });
  });

  test("a voice note's transcript is asked for once and kept", async () => {
    const ch = (await channelsOf("bola")).find((c) => c.name === "studio-crew");
    const page = await as("bola").get(`/community/channels/${ch.community_channel_id}/messages`);
    const note = page.body.data.find((m) => m.message_type === "audio");
    const t = await as("bola").post(`/community/messages/${note.community_message_id}/transcript`).send({});
    expect(t.status).toBe(200);
    expect(typeof t.body.transcript).toBe("string");
    const stored = await one("SELECT transcript FROM community_message WHERE community_message_id = $1", [note.community_message_id]);
    expect(stored.transcript).toBe(t.body.transcript);
  });

  describe("media and links (community.md §3 steps 17 and 18)", () => {
    const READY = { status: "ready", title: "Nfelia: Fashion in Lagos", description: "Shop the latest.", site_name: "Nfelia" };
    beforeEach(() => {
      pageCard.fetchCard.mockReset();
      queues.enqueue.mockClear();
    });

    test("the composer's card: fetched once, kept for everyone, its picture readable by any colleague", async () => {
      pageCard.fetchCard.mockResolvedValue({ ...READY, url: "https://nfelia.com/", image: { buffer: PNG, name: "preview.png" } });
      const first = await as("bola").post("/community/link-previews").send({ url: "Nfelia.com#top" });
      expect(first.status).toBe(200);
      expect(first.body.preview).toMatchObject({ url: "https://nfelia.com/", title: "Nfelia: Fashion in Lagos", site_name: "Nfelia", description: "Shop the latest." });
      expect(first.body.preview.image).toMatchObject({ mime_type: "image/png" });
      expect(pageCard.fetchCard).toHaveBeenCalledWith("https://nfelia.com/");

      // Kept: the next person asking gets it without a fetch.
      const again = await as("tunde").post("/community/link-previews").send({ url: "https://nfelia.com" });
      expect(again.body.preview.community_link_preview_id).toBe(first.body.preview.community_link_preview_id);
      expect(pageCard.fetchCard).toHaveBeenCalledTimes(1);
      expect((await as("ceo").get(`/documents/${first.body.preview.image.document_id}/content`)).status).toBe(200);

      // Nothing to fetch for an address that is not on the web, and no card for a page with no title.
      expect((await as("bola").post("/community/link-previews").send({ url: "http://intranet:8080" })).body).toEqual({ preview: null });
      pageCard.fetchCard.mockResolvedValue({ status: "empty" });
      expect((await as("bola").post("/community/link-previews").send({ url: "https://blank.example.com" })).body).toEqual({ preview: null });
      expect(pageCard.fetchCard).toHaveBeenCalledTimes(2);
      const audit = await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'link_preview.fetched'");
      expect(audit.n).toBe(2);
    });

    test("a text gets its first link's card at once when kept, after the post otherwise, and none when removed", async () => {
      const g = await general("bola");
      const post = (body) => as("bola").post(`/community/channels/${g.community_channel_id}/messages`).send(body);

      const kept = await post({ message_type: "text", body: "New arrivals at https://nfelia.com/ today" });
      expect(kept.status).toBe(201);
      expect(kept.body.link).toMatchObject({ url: "https://nfelia.com/", title: "Nfelia: Fashion in Lagos" });

      pageCard.fetchCard.mockResolvedValue({ ...READY, title: "MyCity App", site_name: "MyCity", url: "https://mycityapp.io/", image: null });
      const fresh = await post({ message_type: "text", body: "Our site: mycityapp.io" });
      expect(fresh.body.link).toBeNull();
      await drain();
      expect(queues.enqueue).toHaveBeenCalledWith(
        "link-preview",
        "card",
        { community_message_id: fresh.body.community_message_id, url: "https://mycityapp.io/" },
        expect.objectContaining({ jobId: expect.stringMatching(/^link-preview-/) }),
      );
      expect(await links.attach(fresh.body.community_message_id, "https://mycityapp.io/")).toMatchObject({ attached: true });
      await drain();
      expect(realtime.toUser).toHaveBeenCalledWith(
        people.tunde.user.user_id,
        "community.message_updated",
        expect.objectContaining({ community_message_id: fresh.body.community_message_id }),
      );
      const page = await as("tunde").get(`/community/channels/${g.community_channel_id}/messages`);
      expect(page.body.data.find((m) => m.community_message_id === fresh.body.community_message_id).link).toMatchObject({
        title: "MyCity App",
        image: null,
      });
      // The job running twice changes nothing.
      expect(await links.attach(fresh.body.community_message_id, "https://mycityapp.io/")).toMatchObject({ attached: false });

      queues.enqueue.mockClear();
      const removed = await post({ message_type: "text", body: "See https://other.example.com", no_link_preview: true });
      expect(removed.body.link).toBeNull();
      await drain();
      expect(queues.enqueue).not.toHaveBeenCalledWith("link-preview", expect.anything(), expect.anything(), expect.anything());

      // Edited within its 15 minutes, a text follows its new first link.
      const edited = await as("bola").put(`/community/messages/${kept.body.community_message_id}`).send({ body: "Moved to mycityapp.io" });
      expect(edited.body.link).toMatchObject({ url: "https://mycityapp.io/" });
      const plain = await as("bola").put(`/community/messages/${kept.body.community_message_id}`).send({ body: "No link now" });
      expect(plain.body.link).toBeNull();
    });

    test("files sent together share an album key, the caption rides on the first, and the list line says it", async () => {
      const ch = (await channelsOf("bola")).find((c) => c.name === "studio-crew");
      const id = ch.community_channel_id;
      const album = "7f8e2a3c-1b2d-4e5f-8a9b-0c1d2e3f4a5b";
      const sent = [];
      for (const [i, name] of ["a.png", "b.png"].entries()) {
        const up = await as("bola").post(`/community/channels/${id}/media`).attach("file", PNG, name);
        const res = await as("bola").post(`/community/channels/${id}/messages`).send({
          message_type: "file",
          document_id: up.body.document_id,
          album_key: album,
          ...(i === 0 ? { body: "Set for Friday" } : {}),
        });
        expect(res.status).toBe(201);
        sent.push(res.body);
      }
      expect(sent.map((m) => [m.message_type, m.album_key, m.body])).toEqual([
        ["image", album, "Set for Friday"],
        ["image", album, null],
      ]);
      expect(sent[0].document).toMatchObject({ width: 1, height: 1, page_count: null, mime_type: "image/png" });
      expect(Array.isArray(sent[0].document.variants)).toBe(true);
      // A caption is searchable, and the list shows the last file's line.
      expect((await as("tunde").get(`/community/channels/${id}/messages?q=friday`)).body.data).toHaveLength(1);
      expect((await channelsOf("tunde")).find((c) => c.name === "studio-crew").last_text).toBe("Photo");
    });

    test("a PDF: queued for its first page, drawn with its pages counted, and its conversation told", async () => {
      const ch = (await channelsOf("bola")).find((c) => c.name === "studio-crew");
      const id = ch.community_channel_id;
      const up = await as("bola").post(`/community/channels/${id}/media`).attach("file", pdfOf(3), "Call sheet.pdf");
      expect(up.status).toBe(201);
      const stored = await one("SELECT payload FROM event_log WHERE event_key = 'document.stored' AND entity_id = $1", [up.body.document_id]);
      expect(stored.payload.needs).toEqual(["pdf"]);
      const posted = await as("bola").post(`/community/channels/${id}/messages`).send({ message_type: "file", document_id: up.body.document_id });
      expect(posted.body).toMatchObject({ message_type: "file", document: { page_count: null, variants: [] } });

      const done = await mediaDerive({ data: { document_id: up.body.document_id } });
      expect(done).toMatchObject({ page_count: 3, variants: ["webp-960", "webp-320"] });
      await drain();
      expect(realtime.toUser).toHaveBeenCalledWith(
        people.tunde.user.user_id,
        "community.message_updated",
        expect.objectContaining({ community_message_id: posted.body.community_message_id }),
      );
      const page = await as("tunde").get(`/community/channels/${id}/messages`);
      const card = page.body.data.find((m) => m.community_message_id === posted.body.community_message_id).document;
      expect(card).toMatchObject({ file_name: "Call sheet.pdf", page_count: 3, width: 595, height: 842, variants: ["webp-320", "webp-960"] });
      const picture = await as("tunde").get(`/documents/${up.body.document_id}/variant/webp-960`);
      expect(picture.status).toBe(200);
      expect(picture.headers["content-type"]).toBe("image/webp");

      // A broken PDF fails at once and keeps its plain card.
      const broken = await as("bola").post(`/community/channels/${id}/media`).attach("file", Buffer.from("%PDF-1.4\nnot really"), "broken.pdf");
      await expect(mediaDerive({ data: { document_id: broken.body.document_id } })).rejects.toThrow(/could not be drawn/);
    });
  });
});
