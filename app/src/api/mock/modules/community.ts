import type { Message } from "@/api/types/community";
import { at, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid, fold } from "../core";
import { byId, byKey, managerOf, PEOPLE, ref, refKey } from "../data/people";

const ANN_POSTERS = new Set(["cynthia", "ifeoma"]);
const BDAY = ["Wishing you a year of good work and better rest.", "Here is to another year around the sun, from all of us.", "May this year be your best at MyCity yet."];
const ANNIV = ["Thank you for the years of work that keep this place running.", "Here is to the next one, and the one after that."];

let seq = 0;
function msg(kind: Message["kind"], author: string, when: string, over: Partial<Message> = {}): Message & { _by: string } {
  return {
    message_id: sid(`m:${++seq}`), kind, author: refKey(author), mine: false, created_at: when, text: null, voice: null, file: null, celebration: null, recognition: null, poll: null, announcement: null, status: null, ...over, _by: author,
  };
}
const fileRef = (name: string, kb: number) => ({ document_id: sid(`doc:${name}`), file_name: name, size_bytes: kb * 1024, mime_type: "application/octet-stream" });

const ANNOUNCEMENTS = [
  ["Q4 review cycle opens", "Self ratings open on the 20th. Managers review from the 27th.", "cynthia", -6, true, 0],
  ["New faces in Enugu", "Two content roles join on the 20th. Say hello in #enugu-launch.", "cynthia", 8, false, 19],
  ["Saturday hours confirmed", "Saturdays are 09:00 to 15:00 for all departments. Clock in applies as on weekdays.", "cynthia", 13, false, 24],
  ["NDPA refresher due", "Everyone must complete the data protection refresher before 30 November.", "cynthia", 16, false, 23],
  ["Ember to Remember kicks off", "The 100 day calendar runs to 31 December. All hands on the Lagos leg.", "ifeoma", 22, false, 25],
].map((a, i) => ({ announcement_id: sid(`ann:${i}`), title: a[0] as string, body: a[1] as string, author: refKey(a[2] as string), publish_at: (a[3] as number) < 0 ? at(a[3] as number, "09:00") : at(a[3] as number, "09:00"), scheduled: a[4] as boolean, reads: a[5] as number, audience: PEOPLE.length, _by: a[2] as string }));

interface Chan { channel_id: string; name: string; members: string[]; read_only: boolean; pinned: boolean; unread: number; msgs: Array<Message & { _by: string }> }
const everyone = PEOPLE.map((p) => p.user_key);
const CHANNELS: Chan[] = [
  { channel_id: sid("ch:announcements"), name: "announcements", members: everyone, read_only: true, pinned: true, unread: 0, msgs: ANNOUNCEMENTS.filter((a) => !a.scheduled).reverse().map((a) => msg("announcement", a._by, a.publish_at, { announcement: { title: a.title, body: a.body } })) },
  {
    channel_id: sid("ch:general"), name: "general", members: everyone, read_only: false, pinned: false, unread: 3,
    msgs: [
      msg("anniversary", "emeka", at(1, "00:01"), { celebration: { subject: refKey("emeka"), years: 3, count: 11, mine: false, fans: ["ngozi", "adedotun", "chidera"].map(refKey), wish: ANNIV[0] } }),
      msg("text", "ngozi", at(1, "17:42"), { text: "Congratulations Emeka, three years of the studio running like clockwork." }),
      msg("birthday", "hauwa", at(0, "00:01"), { celebration: { subject: refKey("hauwa"), years: null, count: 14, mine: false, fans: ["adedotun", "tolu", "ngozi"].map(refKey), wish: BDAY[1] } }),
      msg("recognition", "cynthia", at(0, "07:10"), { text: "Turned the Enugu shot list around in a day.", recognition: { to: refKey("tolu"), count: 6, mine: false } }),
      msg("text", "adedotun", at(0, "08:31"), { text: "Happy birthday Hauwa! Cake at the Abuja hub at 4?" }),
      msg("poll", "cynthia", at(0, "08:40"), { poll: { question: "Team lunch on Friday: where?", options: [{ text: "Jollof Joint, VI", votes: 7 }, { text: "Bukka Hut", votes: 4 }, { text: "Order in to the office", votes: 3 }], my_vote: null } }),
    ],
  },
  {
    channel_id: sid("ch:ember"), name: "ember-to-remember", members: everyone.slice(0, 18), read_only: false, pinned: false, unread: 0,
    msgs: [
      msg("text", "adedotun", at(0, "08:14"), { text: "Stage build for the Lagos leg is confirmed. MTN have signed off on the branding placement." }),
      msg("text", "tolu", at(0, "08:21"), { text: "Shot list for the Enugu segment is in the vault. Three locations, two days." }),
      msg("text", "ngozi", at(0, "09:02"), { text: "ProvidusBank want their logo on the ticket confirmation email. Raising it as a task against the partnership." }),
      msg("text", "cynthia", at(0, "09:08"), { text: "Good. Link it to the MOU so it shows on the 360." }),
      msg("file", "seyi", at(0, "09:12"), { file: fileRef("ember-venue-list-v3.xlsx", 84) }),
      msg("text", "emeka", at(0, "09:21"), { text: "Studio is booked for the 22nd and 23rd. Equipment repair is still with Operations." }),
    ],
  },
  { channel_id: sid("ch:operations"), name: "operations", members: everyone, read_only: false, pinned: false, unread: 0, msgs: [msg("text", "cynthia", at(1, "16:10"), { text: "Generator service moved to Thursday. Please save your work before 14:00." })] },
  { channel_id: sid("ch:partnerships"), name: "partnerships", members: ["cynthia", "ifeoma", "ngozi", "bashir", "grace", "adedotun", "tobi", "amara", "tolu"], read_only: false, pinned: false, unread: 1, msgs: [msg("text", "ngozi", at(1, "15:22"), { text: "Filmhouse prefer a revenue share over a flat listing fee. Modelling it with Amara." })] },
  { channel_id: sid("ch:enugu"), name: "enugu-launch", members: ["cynthia", "ifeoma", "tolu", "emeka", "chidera", "kemi"], read_only: false, pinned: false, unread: 0, msgs: [msg("text", "chidera", at(8, "11:04"), { text: "Two content roles join on the 20th. Desk space is sorted." })] },
];
/* Pad #general with older history so "Load Older" has something to load. */
for (let d = 30; d >= 2; d -= 1) CHANNELS[1].msgs.unshift(msg("text", PEOPLE[d % PEOPLE.length].user_key, at(d, `1${d % 8}:${String(10 + d).padStart(2, "0")}`), { text: ["Morning all.", "Who has the projector remote?", "Lunch order going in at 12.", "Reminder: timesheets by Friday.", "Great work on the launch, team."][d % 5] }));

interface Dm { conversation_id: string; a: string; b: string; online: boolean; unread: number; msgs: Array<Message & { _by: string }> }
const DMS: Dm[] = [
  ["ifeoma", true, 1, [["ifeoma", 1, "18:02", "Did the Content target get approved?"], ["cynthia", 1, "18:14", "Yes, you approved it at 16:40. Marketing and Operations are still with you."], ["ifeoma", 0, "07:52", "Cynthia, has the JBS requisition gone through?"], ["cynthia", 0, "07:58", "Yes, it is with you for approval. REQ-0042, ₦1,841,500.00 across five requests."], ["ifeoma", 0, "08:03", "Seen. Approving this morning."]]],
  ["tolu", true, 0, [["tolu", 1, "14:20", "Shot list uploaded. Quick one on the Enugu permits:"], ["tolu", 1, "14:21", "vn:24"], ["cynthia", 1, "14:35", "Got it. I will call the state office in the morning."]]],
  ["adedotun", false, 0, [["adedotun", 1, "11:02", "file:mtn-sponsor-deck.pdf"], ["adedotun", 1, "11:02", "Sent the sponsor deck."]]],
  ["bashir", false, 2, [["bashir", 1, "10:15", "Can we move the Eko call?"], ["bashir", 1, "10:16", "Thursday afternoon works for them."]]],
  ["amara", false, 0, [["amara", 6, "17:30", "Payroll preview ready for your review."]]],
  ["hauwa", true, 0, [["hauwa", 0, "09:40", "Thank you for the birthday wishes!"]]],
].map(([other, online, unread, rows], i) => ({
  conversation_id: sid(`dm:${i}`), a: "cynthia", b: other as string, online: online as boolean, unread: unread as number,
  msgs: (rows as Array<[string, number, string, string]>).map(([who, d, t, x]) =>
    x.startsWith("vn:") ? msg("voice", who, at(d, t), { voice: { duration_s: Number(x.slice(3)), transcript: null } })
      : x.startsWith("file:") ? msg("file", who, at(d, t), { file: fileRef(x.slice(5), 3200) })
      : msg("text", who, at(d, t), { text: x, status: who === "cynthia" ? "read" : null })),
}));
const TRANSCRIPTS: Record<string, string> = { tolu: "Hi Cynthia, quick one on the Enugu permits. The state office wants the letter on our letterhead and signed by you, not by me. If you can sign it today I will drop it off first thing tomorrow." };

const view = (m: Message & { _by: string }, user: string): Message => {
  const { _by, ...rest } = m;
  return { ...rest, mine: _by === user };
};
const describe = (m: Message) =>
  m.kind === "text" ? m.text : m.kind === "voice" ? "Voice note" : m.kind === "file" ? m.file?.file_name : m.kind === "announcement" ? m.announcement?.title : m.kind === "birthday" ? `Happy birthday, ${m.celebration?.subject.display_name}` : m.kind === "anniversary" ? `Work anniversary, ${m.celebration?.subject.display_name}` : m.kind === "recognition" ? `${m.author.display_name} recognised ${m.recognition?.to.display_name}` : `Poll: ${m.poll?.question}`;

/** Newest page first: page 1 is the latest 25, page 2 the 25 before. Each page is returned oldest to newest. */
function messagePage(msgs: Array<Message & { _by: string }>, user: string, query: Record<string, string>) {
  const q = fold(query.q ?? "").trim();
  const list = q ? msgs.filter((m) => fold(describe(m)).includes(q)) : msgs;
  const size = __CONTRACT_PAGE_SIZE__;
  const n = Math.max(1, Number(query.page ?? 1));
  const total = list.length;
  const pages = Math.ceil(total / size);
  const end = total - (n - 1) * size;
  const data = list.slice(Math.max(0, end - size), Math.max(0, end)).map((m) => view(m, user));
  return ok({ data, page: { number: n, size, total, pages, has_next: n < pages } });
}

const chanOut = (c: Chan, user: string) => {
  const last = c.msgs[c.msgs.length - 1];
  return { channel_id: c.channel_id, name: c.name, members: c.members.length, read_only: c.read_only, can_post: !c.read_only || ANN_POSTERS.has(user), pinned: c.pinned, unread: c.unread, last_text: last ? describe(last) ?? null : null, last_at: last?.created_at ?? null };
};
route("GET /api/v1/community/channels", (req) =>
  paged(CHANNELS.filter((c) => c.members.includes(req.user!)).map((c) => chanOut(c, req.user!)).sort((a, b) => Number(b.pinned) - Number(a.pinned)), req, { search: (c) => [c.name] }),
);
route("POST /api/v1/community/channels", (req) => {
  const b = req.body as { name: string; member_ids: string[]; departments: string[]; post_policy: string };
  const name = String(b.name ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  if (name.length < 3) return invalid({ name: ["At least 3 letters"] });
  if (CHANNELS.some((c) => c.name === name)) return invalid({ name: ["is already in use"] });
  const members = new Set([req.user!, ...(b.member_ids ?? []).map((id) => byId(id)?.user_key).filter(Boolean) as string[], ...PEOPLE.filter((p) => (b.departments ?? []).includes(p.department)).map((p) => p.user_key)]);
  const c: Chan = { channel_id: sid(`ch:${name}`), name, members: [...members], read_only: b.post_policy === "admins", pinned: false, unread: 0, msgs: [] };
  CHANNELS.push(c);
  return created(chanOut(c, req.user!));
});
const chan = (id: string) => CHANNELS.find((c) => c.channel_id === id);
route("GET /api/v1/community/channels/:id/members", (req) => {
  const c = chan(req.params.id);
  return c ? paged(c.members.map((k) => refKey(k)), req, { search: (p) => [p.display_name, p.department] }) : notFound();
});
route("POST /api/v1/community/channels/:id/read", (req) => {
  const c = chan(req.params.id);
  if (c) c.unread = 0;
  return ok(null);
});
route("POST /api/v1/community/channels/:id/mute", () => ok(null));
route("GET /api/v1/community/channels/:id/messages", (req) => {
  const c = chan(req.params.id);
  return c ? messagePage(c.msgs, req.user!, req.query) : notFound();
});
function build(user: string, b: Record<string, unknown>): (Message & { _by: string }) | string {
  const now = new Date().toISOString();
  if (b.kind === "text") {
    const t = String(b.text ?? "").trim();
    return t ? msg("text", user, now, { text: t }) : "Write a message";
  }
  if (b.kind === "voice") return msg("voice", user, now, { voice: { duration_s: Number(b.duration_s ?? 3), transcript: null } });
  if (b.kind === "file") return msg("file", user, now, { file: fileRef(String(b.text ?? "file"), 120) });
  if (b.kind === "poll") {
    const p = b.poll as { question: string; options: string[] };
    return p?.question && p.options?.length >= 2 ? msg("poll", user, now, { poll: { question: p.question, options: p.options.map((t) => ({ text: t, votes: 0 })), my_vote: null } }) : "A question and two options";
  }
  if (b.kind === "birthday" || b.kind === "anniversary") {
    const s = byId(String(b.subject_id));
    return s ? msg(b.kind, s.user_key, now, { celebration: { subject: ref(s)!, years: b.kind === "anniversary" ? 2 : null, count: 0, mine: false, fans: [], wish: (b.kind === "birthday" ? BDAY : ANNIV)[0] } }) : "Choose who";
  }
  return "Unknown kind";
}
route("POST /api/v1/community/channels/:id/messages", (req) => {
  const c = chan(req.params.id);
  if (!c) return notFound();
  if (c.read_only && !ANN_POSTERS.has(req.user!)) return fail(403, "POST_POLICY", "Only People and the CEO post here.");
  const m = build(req.user!, req.body);
  if (typeof m === "string") return invalid({ text: [m] });
  c.msgs.push(m);
  return created(view(m, req.user!));
});
route("POST /api/v1/community/channels/:id/recognitions", (req) => {
  const c = chan(req.params.id);
  const to = byId(String(req.body.to_employee_id));
  if (!c || !to) return notFound();
  if (to.user_key === req.user) return invalid({ to_employee_id: ["You cannot recognise yourself"] });
  const m = msg("recognition", req.user!, new Date().toISOString(), { text: String(req.body.text || "Thank you for the great work this week."), recognition: { to: ref(to)!, count: 0, mine: false } });
  c.msgs.push(m);
  return created(view(m, req.user!));
});
const anyMsg = (id: string) => [...CHANNELS.flatMap((c) => c.msgs), ...DMS.flatMap((d) => d.msgs)].find((m) => m.message_id === id);
route("POST /api/v1/community/messages/:id/reactions", (req) => {
  const m = anyMsg(req.params.id);
  if (!m) return notFound();
  const target = m.celebration ?? m.recognition;
  if (target) {
    target.mine = !target.mine;
    target.count += target.mine ? 1 : -1;
    if (m.celebration) m.celebration.fans = target.mine ? [refKey(req.user!), ...m.celebration.fans] : m.celebration.fans.filter((f) => f.employee_id !== byKey(req.user)!.employee_id);
  }
  return ok(view(m, req.user!));
});
route("POST /api/v1/community/messages/:id/vote", (req) => {
  const m = anyMsg(req.params.id);
  if (!m?.poll) return notFound();
  const o = Number(req.body.option);
  if (m.poll.my_vote != null) m.poll.options[m.poll.my_vote].votes -= 1;
  m.poll.my_vote = o;
  m.poll.options[o].votes += 1;
  return ok(view(m, req.user!));
});
route("POST /api/v1/community/messages/:id/transcript", async (req) => {
  const m = anyMsg(req.params.id);
  if (!m?.voice) return notFound();
  await new Promise((r) => setTimeout(r, 900));
  m.voice.transcript = TRANSCRIPTS[m._by] ?? "Quick update: all on track for Friday. I will send the details in writing.";
  return ok({ transcript: m.voice.transcript });
});

const other = (d: Dm, user: string) => (d.a === user ? d.b : d.a);
const dmOut = (d: Dm, user: string) => {
  const last = d.msgs[d.msgs.length - 1];
  return { conversation_id: d.conversation_id, person: refKey(other(d, user)), online: d.online, unread: d.unread, last_text: last ? describe(last) ?? null : null, last_mine: last?._by === user, last_at: last?.created_at ?? null };
};
route("GET /api/v1/community/direct", (req) =>
  paged(DMS.filter((d) => d.a === req.user || d.b === req.user).map((d) => ({ ...dmOut(d, req.user!), _u: d.unread })), req, { search: (d) => [d.person.display_name], filters: { unread: (d, v) => (v === "true" ? d._u > 0 : true) } }),
);
route("POST /api/v1/community/direct", (req) => {
  const p = byId(String(req.body.user_id));
  if (!p) return notFound();
  let d = DMS.find((x) => (x.a === req.user && x.b === p.user_key) || (x.b === req.user && x.a === p.user_key));
  if (!d) {
    d = { conversation_id: sid(`dm:${req.user}:${p.user_key}`), a: req.user!, b: p.user_key, online: false, unread: 0, msgs: [] };
    DMS.unshift(d);
  }
  return ok(dmOut(d, req.user!));
});
const dm = (id: string) => DMS.find((d) => d.conversation_id === id);
route("GET /api/v1/community/direct/:id/messages", (req) => {
  const d = dm(req.params.id);
  if (!d) return notFound();
  d.unread = 0;
  return messagePage(d.msgs, req.user!, req.query);
});
route("POST /api/v1/community/direct/:id/messages", (req) => {
  const d = dm(req.params.id);
  if (!d) return notFound();
  const m = build(req.user!, req.body);
  if (typeof m === "string") return invalid({ text: [m] });
  m.status = "sent";
  d.msgs.push(m);
  setTimeout(() => (m.status = "delivered"), 800);
  if (d.online) setTimeout(() => (m.status = "read"), 2600);
  return created(view(m, req.user!));
});
route("GET /api/v1/community/people/:user_id/card", (req) => {
  const p = byId(req.params.user_id);
  if (!p) return notFound();
  const d = DMS.find((x) => x.b === p.user_key || x.a === p.user_key);
  return ok({
    person: ref(p)!, email: p.work_email, phone: p.phone, location: p.work_pattern === "remote" ? "Remote, Lagos" : p.worksite, local_time: new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()),
    online: d?.online ?? false, manager: ref(managerOf(p)), shared_channels: CHANNELS.filter((c) => c.members.includes(p.user_key) && c.members.includes(req.user!)).map((c) => c.name),
    shared_files: (d?.msgs ?? []).filter((m) => m.file).map((m) => m.file!),
  });
});

route("GET /api/v1/community/announcements", (req) => paged(ANNOUNCEMENTS.map(({ _by, ...a }) => (void _by, a)), req, { search: (a) => [a.title, a.body] }));
route("POST /api/v1/community/announcements", (req) => {
  if (!ANN_POSTERS.has(req.user!)) return fail(403, "FORBIDDEN", "Only People and the CEO post announcements.");
  const f: Record<string, string[]> = {};
  if (String(req.body.title ?? "").trim().length < 4) f.title = ["Give it a title"];
  if (String(req.body.body ?? "").trim().length < 10) f.body = ["Write at least 10 characters"];
  if (Object.keys(f).length) return invalid(f);
  const when = (req.body.publish_at as string) || new Date().toISOString();
  const scheduled = when > new Date().toISOString();
  const a = { announcement_id: sid(`ann:${Date.now()}`), title: String(req.body.title), body: String(req.body.body), author: refKey(req.user!), publish_at: when, scheduled, reads: 0, audience: PEOPLE.length, _by: req.user! };
  ANNOUNCEMENTS.unshift(a);
  if (!scheduled) CHANNELS[0].msgs.push(msg("announcement", req.user!, when, { announcement: { title: a.title, body: a.body } }));
  const { _by, ...out } = a;
  void _by;
  return created(out);
});
route("GET /api/v1/community/announcements/:id/reads", (req) => {
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === req.params.id);
  if (!a) return notFound();
  const rows = PEOPLE.map((p, i) => ({ person: ref(p)!, read_at: i < a.reads ? at(Math.max(0, 3 - (i % 4)), `0${8 + (i % 2)}:${String(10 + i).padStart(2, "0")}`) : null }));
  return paged(rows, req, { search: (r) => [r.person.display_name], filters: { read: (r, v) => (v === "read" ? !!r.read_at : !r.read_at) } });
});
route("POST /api/v1/community/announcements/:id/remind", (req) => {
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === req.params.id);
  return a ? ok({ reminded: a.audience - a.reads }) : notFound();
});
export const _d = isoDaysAgo;
