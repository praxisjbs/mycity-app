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
    // The CEO holds every authority, so they may post in #announcements.
    expect((await channelsOf("ceo")).find((c) => c.name === "announcements").can_post).toBe(true);
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
    const poll = await as("tunde").post(`/community/channels/${g.community_channel_id}/messages`).send({
      message_type: "poll",
      body: "Team lunch on Friday?",
      options: ["Jollof Joint", "Order in"],
    });
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
    expect((await as("bola").post("/community/direct").send({ employee_id: people.bola.employee.employee_id })).status).toBe(422);

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

    const card = await as("bola").get(`/community/people/${people.tunde.employee.employee_id}/card`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ work_email: "tunde@mycity.test", shared_channels: expect.arrayContaining(["general", "studio-crew"]) });
  });

  test("announcements: People and the CEO only; published to #announcements with read tracking; scheduled ones wait", async () => {
    expect((await as("bola").get("/community/announcements")).status).toBe(403);
    expect((await as("bola").post("/community/announcements").send({ title: "Hello", body: "World" })).status).toBe(403);

    const made = await as("ceo").post("/community/announcements").send({ title: "Saturday hours", body: "Saturdays are 09:00 to 15:00." });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: "published", audience: { kind: "all" }, audience_size: 3, reads: 0 });
    await drain();
    const told = await one("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'announcement.published'", [people.bola.user.user_id]);
    expect(told.title).toBe("Saturday hours");

    const ann = (await channelsOf("bola")).find((c) => c.name === "announcements");
    const msgs = await as("bola").get(`/community/channels/${ann.community_channel_id}/messages`);
    expect(msgs.body.data.at(-1)).toMatchObject({ message_type: "announcement", announcement: { title: "Saturday hours" } });
    expect((await as("bola").post(`/community/channels/${ann.community_channel_id}/messages`).send({ message_type: "text", body: "hi" })).status).toBe(403);

    const reads = await as("ceo").get(`/community/announcements/${made.body.announcement_id}/reads?read=read`);
    expect(reads.body.data.map((r) => r.person.display_name)).toEqual(["Bola Ade"]);
    const remind = await as("ceo").post(`/community/announcements/${made.body.announcement_id}/remind`).send({});
    expect(remind.body).toEqual({ reminded: 2 });
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
});
