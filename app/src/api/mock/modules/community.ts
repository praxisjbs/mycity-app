import type { Announcement, AnnouncementStats, Channel, Conversation, LinkPreview, MediaRef, Member, Message, ProfileCard } from "@/api/types/community";
import { firstLink, hostOf } from "@mycity/ui";
import { at, created, fail, invalid, noContent, notFound, ok, paged, route, sid, fold } from "../core";
import { byId, byKey, DEPARTMENTS, PEOPLE, SIGN_INS } from "../data/people";
import { UPLOADS } from "../uploads";

/**
 * Staff Community on the mock, in the contract's own shapes (packages/contract/schemas/
 * community.js and announcements.js). Laptops and CI only (F12). It answers what the API
 * answers: membership decides what a person sees, a recognition always lands in #general,
 * a direct conversation is a channel of type "direct", and announcements are for People
 * and the CEO.
 */

const ANN_POSTERS = new Set(["cynthia", "ifeoma"]);
const BDAY = ["Wishing you a year of good work and better rest.", "Here is to another year around the sun, from all of us."];
const ANNIV = ["Thank you for every one of them.", "Here is to the next one."];

/** A person as the contract's PersonRef. */
type PersonRef = NonNullable<Message["author"]>;
const person = (key: string): PersonRef => {
  const p = byKey(key)!;
  return { employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department, photo_url: null };
};
const uid = (key: string) => sid(`user:${key}`);
const keyOfUser = (userId: string) => PEOPLE.find((p) => uid(p.user_key) === userId)?.user_key;

type MMsg = Message & { _by: string | null; _fans: string[]; _votes: Record<string, number>; _noLink?: boolean };
let seq = 0;
function msg(type: Message["message_type"], by: string | null, when: string, over: Partial<Message> = {}): MMsg {
  return {
    community_message_id: sid(`m:${++seq}`),
    community_channel_id: "",
    message_type: type,
    author: by ? person(by) : null,
    mine: false,
    sent_at: when,
    body: null,
    document: null,
    album_key: null,
    link: null,
    duration_s: null,
    transcript: null,
    celebration: null,
    recognition: null,
    poll: null,
    announcement: null,
    status: null,
    deleted: false,
    edited_at: null,
    can_edit: false,
    can_delete: false,
    can_close: false,
    ...over,
    _by: by,
    _fans: [],
    _votes: {},
  };
}
/** A file as a message carries it: its shape and the sizes the worker made (a laptop holds no bytes, so the bubbles keep their places). */
const fileRef = (name: string, kb: number, mime = "application/octet-stream", over: Partial<MediaRef> = {}): MediaRef => ({
  document_id: sid(`doc:${name}`),
  file_name: name,
  size_bytes: kb * 1024,
  mime_type: mime,
  width: null,
  height: null,
  page_count: null,
  duration_ms: null,
  variants: [],
  ...over,
});
const SIZES = ["webp-320", "webp-960"];
const photoRef = (name: string, kb: number, width: number, height: number) => fileRef(name, kb, "image/jpeg", { width, height, variants: SIZES });
const pdfRef = (name: string, kb: number, pages: number) => fileRef(name, kb, "application/pdf", { width: 960, height: 1358, page_count: pages, variants: SIZES });

/*
 * Link cards: what the server reads from a page's Open Graph tags, for the pages the sample
 * messages link to. Any other page gets a card of its host and no picture, as a page with a
 * title and nothing more would.
 */
const CARDS: Record<string, Omit<LinkPreview, "community_link_preview_id" | "url">> = {
  "nfelia.com": { site_name: "Nfelia", title: "Nfelia: Fashion in Lagos", description: "Ready to wear from Lagos designers, delivered across Nigeria.", image: fileRef("nfelia-og.jpg", 96, "image/jpeg", { width: 1200, height: 630, variants: SIZES }) },
  "mycityapp.io": { site_name: "MyCity App", title: "MyCity App: Events and Tickets", description: "Find what is on in your city this weekend.", image: fileRef("mycity-og.jpg", 80, "image/jpeg", { width: 1200, height: 630, variants: SIZES }) },
};
function cardFor(url: string | null): LinkPreview | null {
  if (!url) return null;
  const host = hostOf(url);
  const known = CARDS[host];
  return { community_link_preview_id: sid(`lp:${url}`), url, ...(known ?? { site_name: host, title: host.charAt(0).toUpperCase() + host.slice(1), description: null, image: null }) };
}
const linked = (by: string, when: string, body: string) => msg("text", by, when, { body, link: cardFor(firstLink(body)) });
/** Photos sent together: one album key, the caption on the first. */
const album = (by: string, when: string, names: string[], caption: string) => {
  const key = sid(`album:${names[0]}`);
  return names.map((n, i) => msg("image", by, when, { document: photoRef(n, 420, i % 3 === 1 ? 1080 : 1600, i % 3 === 1 ? 1350 : 1200), album_key: key, body: i === 0 ? caption : null }));
};
const card = (type: "birthday" | "anniversary", who: string, when: string, fans: string[], years: number | null): MMsg => {
  const m = msg(type, null, when, { body: (type === "birthday" ? BDAY : ANNIV)[0] });
  m._fans = fans;
  m.celebration = { subject: person(who), years, count: fans.length, mine: false, fans: [] };
  return m;
};

interface MockAnnouncement {
  announcement_id: string;
  title: string;
  body: string;
  by: string;
  publish_at: string;
  scheduled: boolean;
  departments: string[];
  /** Who has read it; for an urgent one, who has acknowledged it. */
  read: Set<string>;
  reminded: string | null;
  urgency: Announcement["urgency"];
}
const ANNOUNCEMENTS: MockAnnouncement[] = [
  ["Fire drill at 11", "Leave by the east stairs and meet at the car park. Wardens wear the yellow vests.", "ifeoma", 0, false, 12, "urgent"],
  ["Q4 review cycle opens", "Self ratings open on the 20th. Managers review from the 27th.", "cynthia", -6, true, 0],
  ["New faces in Enugu", "Two content roles join on the 20th. Say hello in #enugu-launch.", "cynthia", 8, false, 19],
  ["Saturday hours confirmed", "Saturdays are 09:00 to 15:00 for all departments. Clock in applies as on weekdays.", "cynthia", 13, false, 24],
  ["NDPA refresher due", "Everyone must complete the data protection refresher before 30 November.", "cynthia", 16, false, 23, "important"],
  ["Ember to Remember kicks off", "The 100 day calendar runs to 31 December. All hands on the Lagos leg.", "ifeoma", 22, false, 25],
].map((a, i) => ({
  announcement_id: sid(`ann:${i}`),
  title: a[0] as string,
  body: a[1] as string,
  by: a[2] as string,
  publish_at: at(a[3] as number, "09:00"),
  scheduled: a[4] as boolean,
  departments: [],
  // An urgent one waits on the demonstration accounts, so the bar and Acknowledge show; its poster has it.
  read:
    a[6] === "urgent"
      ? new Set([a[2] as string, ...PEOPLE.filter((p) => !(p.user_key in SIGN_INS)).slice(0, a[5] as number).map((p) => p.user_key)])
      : new Set(PEOPLE.slice(0, a[5] as number).map((p) => p.user_key)),
  reminded: null,
  urgency: (a[6] as Announcement["urgency"] | undefined) ?? "normal",
}));

interface Chan {
  community_channel_id: string;
  name: string;
  description: string | null;
  channel_type: Channel["channel_type"];
  post_policy: Channel["post_policy"];
  pinned: boolean;
  /** Each person's own pin, as the time they pinned it. */
  pins: Map<string, string>;
  members: string[];
  admins: string[];
  muted: Set<string>;
  unread: Record<string, number>;
  msgs: MMsg[];
}
const everyone = PEOPLE.map((p) => p.user_key);
const chan0 = (name: string, members: string[], msgs: MMsg[], over: Partial<Chan> = {}): Chan => {
  const c: Chan = { community_channel_id: sid(`ch:${name}`), name, description: null, channel_type: "group", post_policy: "everyone", pinned: false, pins: new Map(), members, admins: [members[0]], muted: new Set(), unread: {}, msgs, ...over };
  for (const m of c.msgs) m.community_channel_id = c.community_channel_id;
  return c;
};
const annMsg = (a: MockAnnouncement) =>
  msg("announcement", a.by, a.publish_at, {
    body: a.body,
    announcement: { announcement_id: a.announcement_id, title: a.title, urgency: a.urgency, in_audience: false, acknowledged_at: null },
  });
/** Whether `user` is in an announcement's audience: everyone, or its departments' people. */
const inAudience = (a: MockAnnouncement, user: string) => !a.departments.length || a.departments.includes(PEOPLE.find((p) => p.user_key === user)?.department ?? "");

const rec = msg("recognition", "cynthia", at(0, "07:10"), { body: "Turned the Enugu shot list around in a day." });
rec.recognition = { to: person("tolu"), count: 6, mine: false };
rec._fans = ["ngozi", "emeka", "adedotun", "amara", "bashir", "kemi"];
const poll = msg("poll", "cynthia", at(0, "08:40"), { body: "Team lunch on Friday: where?" });
poll.poll = { question: "Team lunch on Friday: where?", options: [{ text: "Jollof Joint, VI", votes: 0 }, { text: "Bukka Hut", votes: 0 }, { text: "Order in to the office", votes: 0 }], my_vote: null, closed: false };
poll._votes = Object.fromEntries(PEOPLE.slice(0, 14).map((p, i) => [p.user_key, i < 7 ? 0 : i < 11 ? 1 : 2]));

const CHANNELS: Chan[] = [
  chan0("announcements", everyone, ANNOUNCEMENTS.filter((a) => !a.scheduled).reverse().map(annMsg), { channel_type: "company", post_policy: "people_ceo", pinned: true, admins: [] }),
  chan0(
    "general",
    everyone,
    [
      card("anniversary", "emeka", at(1, "05:00"), ["ngozi", "adedotun", "chidera"], 3),
      msg("text", "ngozi", at(1, "17:42"), { body: "Congratulations Emeka, three years of the studio running like clockwork." }),
      card("birthday", "hauwa", at(0, "05:00"), ["adedotun", "tolu", "ngozi"], null),
      rec,
      msg("text", "adedotun", at(0, "08:31"), { body: "Happy birthday Hauwa! Cake at the Abuja hub at 4?" }),
      poll,
    ],
    { channel_type: "company", pinned: true, admins: [], unread: { cynthia: 3 } },
  ),
  chan0("ember-to-remember", everyone.slice(0, 18), [
    msg("text", "adedotun", at(0, "08:14"), { body: "Stage build for the Lagos leg is confirmed. MTN have signed off on the branding placement." }),
    msg("text", "tolu", at(0, "08:21"), { body: "Shot list for the Enugu segment is in the vault. Three locations, two days." }),
    msg("audio", "tolu", at(0, "08:23"), { duration_s: 18, document: fileRef("voice-note.webm", 90, "audio/webm") }),
    msg("text", "ngozi", at(0, "09:02"), { body: "ProvidusBank want their logo on the ticket confirmation email. Raising it as a task against the partnership." }),
    msg("text", "cynthia", at(0, "09:08"), { body: "Good. Link it to the MOU so it shows on the 360." }),
    msg("file", "seyi", at(0, "09:12"), { document: fileRef("ember-venue-list-v3.xlsx", 84, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }),
    msg("image", "adedotun", at(0, "09:15"), { document: photoRef("stage-build-lagos.jpg", 640, 1600, 1200), body: "Stage build at Tafawa Balewa Square, day two." }),
    ...album("tolu", at(0, "09:17"), ["enugu-loc-1.jpg", "enugu-loc-2.jpg", "enugu-loc-3.jpg", "enugu-loc-4.jpg", "enugu-loc-5.jpg", "enugu-loc-6.jpg"], "The three Enugu locations, two angles each."),
    msg("file", "ngozi", at(0, "09:19"), { document: pdfRef("providus-mou-signed.pdf", 1840, 12) }),
    linked("ngozi", at(0, "09:20"), "Their lookbook is live on https://nfelia.com if anyone wants the styling references."),
    msg("text", "emeka", at(0, "09:21"), { body: "Studio is booked for the 22nd and 23rd. Equipment repair is still with Operations." }),
  ], { admins: ["cynthia"] }),
  chan0("operations", everyone, [msg("text", "cynthia", at(1, "16:10"), { body: "Generator service moved to Thursday. Please save your work before 14:00." })], { channel_type: "department", admins: ["cynthia"] }),
  chan0("partnerships", ["cynthia", "ifeoma", "ngozi", "bashir", "grace", "adedotun", "tobi", "amara", "tolu"], [msg("text", "ngozi", at(1, "15:22"), { body: "Filmhouse prefer a revenue share over a flat listing fee. Modelling it with Amara." })], { unread: { cynthia: 1 } }),
  chan0("enugu-launch", ["cynthia", "ifeoma", "tolu", "emeka", "chidera", "kemi"], [msg("text", "chidera", at(8, "11:04"), { body: "Two content roles join on the 20th. Desk space is sorted." })]),
];
/* Older history in #general, so "Load Older" has something to load. */
for (let d = 30; d >= 2; d -= 1) {
  const m = msg("text", PEOPLE[d % PEOPLE.length].user_key, at(d, `1${d % 8}:${String(10 + d).padStart(2, "0")}`), {
    body: ["Morning all.", "Who has the projector remote?", "Lunch order going in at 12.", "Reminder: timesheets by Friday.", "Great work on the launch, team."][d % 5],
  });
  m.community_channel_id = CHANNELS[1].community_channel_id;
  CHANNELS[1].msgs.unshift(m);
}

const ONLINE = new Set(["ifeoma", "tolu", "hauwa"]);
const TRANSCRIPTS: Record<string, string> = {
  tolu: "Hi Cynthia, quick one on the Enugu permits. The state office wants the letter on our letterhead and signed by you, not by me. If you can sign it today I will drop it off first thing tomorrow.",
};
const DM_ROWS: Array<[string, number, Array<[string, number, string, string]>]> = [
  ["ifeoma", 1, [["ifeoma", 1, "18:02", "Did the Content target get approved?"], ["cynthia", 1, "18:14", "Yes, you approved it at 16:40. Marketing and Operations are still with you."], ["ifeoma", 0, "07:52", "Cynthia, has the JBS requisition gone through?"], ["cynthia", 0, "07:58", "Yes, it is with you for approval. REQ-0042, ₦1,841,500.00 across five requests."], ["ifeoma", 0, "08:03", "Seen. Approving this morning."]]],
  ["tolu", 0, [["tolu", 1, "14:20", "Shot list uploaded. Quick one on the Enugu permits:"], ["tolu", 1, "14:21", "vn:24"], ["cynthia", 1, "14:35", "Got it. I will call the state office in the morning."]]],
  ["adedotun", 0, [["adedotun", 1, "11:02", "file:mtn-sponsor-deck.pdf"], ["adedotun", 1, "11:02", "Sent the sponsor deck."]]],
  ["bashir", 2, [["bashir", 1, "10:15", "Can we move the Eko call?"], ["bashir", 1, "10:16", "Thursday afternoon works for them."]]],
  ["amara", 0, [["amara", 6, "17:30", "Payroll preview ready for your review."]]],
  ["hauwa", 0, [["hauwa", 0, "09:40", "Thank you for the birthday wishes!"]]],
];
for (const [other, unread, rows] of DM_ROWS) {
  const msgs = rows.map(([who, d, t, x]) =>
    x.startsWith("vn:")
      ? msg("audio", who, at(d, t), { duration_s: Number(x.slice(3)), document: fileRef(`voice-${who}.webm`, 120, "audio/webm") })
      : x.startsWith("file:")
        ? msg("file", who, at(d, t), { document: pdfRef(x.slice(5), 3200, 14) })
        : msg("text", who, at(d, t), { body: x }),
  );
  CHANNELS.push(chan0(`dm-${other}`, ["cynthia", other], msgs, { channel_type: "direct", admins: [], unread: { cynthia: unread } }));
}

const chan = (id: string) => CHANNELS.find((c) => c.community_channel_id === id);
const isMember = (c: Chan | undefined, user: string) => !!c && c.members.includes(user);
/** A channel's moderators: its admins; People and the CEO in the company channels; nobody in a direct conversation. */
const moderates = (c: Chan, user: string) => (c.channel_type === "direct" ? false : c.channel_type === "company" ? ANN_POSTERS.has(user) : c.admins.includes(user));
const canPoll = (c: Chan, user: string) => canPost(c, user) && (c.name === "general" ? ANN_POSTERS.has(user) : true);
/* #announcements takes nothing posted straight in: announcements come from the tab. */
const canPost = (c: Chan, user: string) => (c.post_policy === "people_ceo" ? false : c.post_policy === "admins" ? c.admins.includes(user) : true);

function lineOf(m: Message | undefined): string | null {
  if (!m) return null;
  const t = m.message_type;
  const caption = m.body ? m.body.replace(/\s+/g, " ").trim().slice(0, 120) : null;
  const kind = t === "image" ? "Photo" : t === "video" ? "Video" : t === "file" ? "File" : null;
  if (kind) return caption ? `${kind}: ${caption}` : kind;
  return t === "audio" ? "Voice note" : t === "poll" ? `Poll: ${m.body}` : t === "recognition" ? "Recognition" : t === "birthday" ? "Birthday" : t === "anniversary" ? "Work anniversary" : m.body;
}

/** A message as `user` sees it: theirs or not, their reaction and vote, and the ticks. */
function view(m: MMsg, user: string, c: Chan): Message {
  const { _by, _fans, _votes, _noLink, ...rest } = m;
  const mine = _by === user;
  const voted = Object.keys(_votes).length > 0;
  const closed = Boolean(m.poll?.closed);
  const fresh = Date.now() - new Date(m.sent_at).getTime() < 15 * 60 * 1000;
  const out: Message = {
    ...rest,
    mine,
    can_edit: !m.deleted && mine && ((m.message_type === "text" && fresh) || (m.message_type === "poll" && !closed && !voted)),
    can_delete: !m.deleted && m.message_type !== "announcement" && (mine || moderates(c, user)),
    can_close: !m.deleted && m.message_type === "poll" && !closed && (mine || moderates(c, user)),
  };
  if (m.announcement) {
    const a = ANNOUNCEMENTS.find((x) => x.announcement_id === m.announcement!.announcement_id);
    const acked = !!a && a.urgency === "urgent" && a.read.has(user);
    out.announcement = { ...m.announcement, in_audience: !!a && inAudience(a, user), acknowledged_at: acked ? m.sent_at : null };
  }
  if (m.celebration) out.celebration = { ...m.celebration, count: _fans.length, mine: _fans.includes(user), fans: _fans.slice(0, 3).map(person) };
  if (m.recognition) out.recognition = { ...m.recognition, count: _fans.length, mine: _fans.includes(user) };
  if (m.poll) {
    const votes = Object.values(_votes);
    out.poll = { ...m.poll, options: m.poll.options.map((o, i) => ({ text: o.text, votes: votes.filter((v) => v === i).length })), my_vote: _votes[user] ?? null, closed };
  }
  if (c.channel_type === "direct" && mine && c.members.length > 1) {
    const other = c.members.find((k) => k !== user) ?? user;
    out.status = (c.unread[other] ?? 0) === 0 ? (ONLINE.has(other) ? "read" : "delivered") : "sent";
  }
  return out;
}

/** Newest page first: page 1 is the latest 25, page 2 the 25 before. Each page reads oldest to newest. */
function messagePage(c: Chan, user: string, query: Record<string, string>) {
  for (const k of Object.keys(query)) if (!["page", "q"].includes(k)) return invalid({ [k]: ["is not a filter on this list"] });
  const q = fold(query.q ?? "").trim();
  const list = q ? c.msgs.filter((m) => !m.deleted && fold(`${m.body ?? ""} ${m.transcript ?? ""}`).includes(q)) : c.msgs;
  const size = __CONTRACT_PAGE_SIZE__;
  const n = Math.max(1, Number(query.page ?? 1));
  const total = list.length;
  const pages = Math.ceil(total / size);
  const end = total - (n - 1) * size;
  const data = list.slice(Math.max(0, end - size), Math.max(0, end)).map((m) => view(m, user, c));
  return ok({ data, page: { number: n, size, total, pages, has_next: n < pages } });
}

function channelOut(c: Chan, user: string): Channel {
  const last = c.msgs[c.msgs.length - 1];
  return {
    community_channel_id: c.community_channel_id,
    name: c.name,
    description: c.description,
    channel_type: c.channel_type,
    post_policy: c.post_policy,
    pinned: c.pinned || c.pins.has(user),
    pin_locked: c.pinned,
    members: c.members.length,
    can_post: canPost(c, user),
    is_admin: c.admins.includes(user),
    can_moderate: moderates(c, user),
    can_poll: canPoll(c, user),
    muted: c.muted.has(user),
    unread: c.unread[user] ?? 0,
    last_text: lineOf(last),
    last_at: last?.sent_at ?? null,
  };
}

function conversationOut(c: Chan, user: string): Conversation {
  const other = c.members.find((k) => k !== user) ?? user;
  const last = c.msgs[c.msgs.length - 1];
  return {
    community_channel_id: c.community_channel_id,
    person: person(other),
    user_id: uid(other),
    is_self: other === user,
    online: ONLINE.has(other),
    last_seen_at: ONLINE.has(other) ? null : at(1, "21:14"),
    pinned: c.pins.has(user),
    muted: c.muted.has(user),
    unread: c.unread[user] ?? 0,
    last_text: lineOf(last),
    last_mine: last?._by === user,
    last_at: last?.sent_at ?? null,
  };
}

const usersOf = (employeeIds: unknown, departmentIds: unknown) => {
  const ids = new Set((employeeIds as string[] | undefined) ?? []);
  const depts = new Set(((departmentIds as string[] | undefined) ?? []).map((id) => DEPARTMENTS.find((d) => sid(`dept:${d}`) === id)));
  return PEOPLE.filter((p) => ids.has(p.employee_id) || depts.has(p.department)).map((p) => p.user_key);
};

route("GET /api/v1/community/channels", (req) =>
  paged(
    CHANNELS.filter((c) => c.channel_type !== "direct" && isMember(c, req.user!))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.pins.get(req.user!) ?? "").localeCompare(String(a.pins.get(req.user!) ?? "")) || String(b.msgs.at(-1)?.sent_at).localeCompare(String(a.msgs.at(-1)?.sent_at)))
      .map((c) => channelOut(c, req.user!)),
    req,
    { search: (c) => [c.name] },
  ),
);
route("POST /api/v1/community/channels", (req) => {
  const name = String(req.body.name ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(name)) return invalid({ name: ["Not a valid name"] });
  if (CHANNELS.some((c) => c.name === name)) return fail(409, "NAME_TAKEN", "A channel already has that name", { name: ["Name already taken"] });
  const members = [req.user!, ...usersOf(req.body.member_ids, req.body.department_ids).filter((k) => k !== req.user)];
  const c = chan0(name, members, [], { description: (req.body.description as string) || null, post_policy: req.body.post_policy === "admins" ? "admins" : "everyone", admins: [req.user!] });
  CHANNELS.push(c);
  return created(channelOut(c, req.user!));
});
route("GET /api/v1/community/channels/:id", (req) => {
  const c = chan(req.params.id);
  return isMember(c, req.user!) && c!.channel_type !== "direct" ? ok(channelOut(c!, req.user!)) : notFound();
});
route("GET /api/v1/community/channels/:id/members", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  const rows: Member[] = c!.members.map((k) => ({ person: person(k), user_id: uid(k), member_role: c!.admins.includes(k) ? "admin" : "member", joined_at: at(30, "09:00") }));
  rows.sort((a, b) => Number(b.member_role === "admin") - Number(a.member_role === "admin"));
  return paged(rows, req, { search: (m) => [m.person.display_name] });
});
route("POST /api/v1/community/channels/:id/members", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (!c!.admins.includes(req.user!)) return fail(403, "NOT_CHANNEL_ADMIN", "Only the channel's admins can do this");
  for (const k of usersOf(req.body.member_ids, req.body.department_ids)) if (!c!.members.includes(k)) c!.members.push(k);
  return ok(channelOut(c!, req.user!));
});
route("DELETE /api/v1/community/channels/:id/members/:user_id", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (!c!.admins.includes(req.user!)) return fail(403, "NOT_CHANNEL_ADMIN", "Only the channel's admins can do this");
  const key = keyOfUser(req.params.user_id);
  c!.members = c!.members.filter((k) => k !== key);
  return noContent();
});
route("PUT /api/v1/community/channels/:id/members/:user_id/role", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (!c!.admins.includes(req.user!)) return fail(403, "NOT_CHANNEL_ADMIN", "Only the channel's admins can do this");
  const key = keyOfUser(req.params.user_id);
  if (!key || !c!.members.includes(key)) return notFound();
  if (req.body.member_role === "admin") {
    if (!c!.admins.includes(key)) c!.admins.push(key);
  } else {
    if (c!.admins.length === 1 && c!.admins[0] === key) return fail(422, "LAST_ADMIN", "A channel needs at least one admin");
    c!.admins = c!.admins.filter((k) => k !== key);
  }
  const out: Member = { person: person(key), user_id: uid(key), member_role: c!.admins.includes(key) ? "admin" : "member", joined_at: at(30, "09:00") };
  return ok(out);
});
route("POST /api/v1/community/channels/:id/mute", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (req.body.muted) c!.muted.add(req.user!);
  else c!.muted.delete(req.user!);
  return noContent();
});
route("PUT /api/v1/community/channels/:id/pin", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (c!.pinned) return fail(422, "ALWAYS_PINNED", "This channel is pinned for everyone");
  if (!req.body.pinned) c!.pins.delete(req.user!);
  else if (!c!.pins.has(req.user!)) {
    if (CHANNELS.filter((x) => x.pins.has(req.user!)).length >= 3) return fail(409, "PIN_LIMIT", "Unpin one first");
    c!.pins.set(req.user!, new Date().toISOString());
  }
  return noContent();
});
route("POST /api/v1/community/channels/:id/read", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  c!.unread[req.user!] = 0;
  return noContent();
});
route("POST /api/v1/community/channels/:id/delivered", (req) => (isMember(chan(req.params.id), req.user!) ? noContent() : notFound()));
route("GET /api/v1/community/channels/:id/messages", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (c!.post_policy === "people_ceo") for (const a of ANNOUNCEMENTS) a.read.add(req.user!);
  return messagePage(c!, req.user!, req.query);
});

const isMsg = (m: MMsg | Record<string, string[]>): m is MMsg => typeof (m as MMsg).community_message_id === "string";
function build(user: string, b: Record<string, unknown>): MMsg | Record<string, string[]> {
  const now = new Date().toISOString();
  const type = b.message_type as Message["message_type"];
  if (type === "text") {
    const body = String(b.body ?? "").trim();
    if (!body) return { body: ["Write something"] };
    const m = msg("text", user, now, { body, link: b.no_link_preview ? null : cardFor(firstLink(body)) });
    m._noLink = Boolean(b.no_link_preview);
    return m;
  }
  if (type === "poll") {
    const opts = (b.options as string[] | undefined) ?? [];
    if (!b.body) return { body: ["Add a question"] };
    if (opts.length < 2) return { options: ["Add an option"] };
    const m = msg("poll", user, now, { body: String(b.body) });
    m.poll = { question: String(b.body), options: opts.map((text) => ({ text, votes: 0 })), my_vote: null, closed: false };
    return m;
  }
  if (type === "birthday" || type === "anniversary") {
    const s = byId(String(b.subject_employee_id));
    if (!s) return { subject_employee_id: ["Choose a colleague"] };
    const m = card(type, s.user_key, now, [], type === "anniversary" ? 2 : null);
    m._by = user;
    m.author = person(user);
    return m;
  }
  const stored = UPLOADS.get(String(b.document_id));
  if (!stored) return { document_id: ["Attach the file again"] };
  const doc: MediaRef = { width: null, height: null, page_count: null, duration_ms: null, variants: [], ...stored };
  const kind = type === "audio" ? "audio" : /^image\//.test(doc.mime_type) ? "image" : /^audio\//.test(doc.mime_type) ? "audio" : /^video\//.test(doc.mime_type) ? "video" : "file";
  const album_key = kind !== "audio" && typeof b.album_key === "string" ? b.album_key : null;
  return msg(kind, user, now, { document: doc, album_key, duration_s: kind === "audio" ? Number(b.duration_s ?? 1) : null, body: (b.body as string) || null });
}
route("POST /api/v1/community/channels/:id/messages", (req) => {
  const c = chan(req.params.id);
  if (!isMember(c, req.user!)) return notFound();
  if (!canPost(c!, req.user!)) return fail(403, "CANNOT_POST", "You cannot post in this channel");
  if (req.body.message_type === "poll" && !canPoll(c!, req.user!)) return fail(403, "CANNOT_POLL", "Only moderators start a poll here");
  if ((req.body.message_type === "birthday" || req.body.message_type === "anniversary") && !moderates(c!, req.user!)) return fail(403, "CANNOT_CELEBRATE", "Only moderators post a celebration here");
  const m = build(req.user!, req.body);
  if (!isMsg(m)) return invalid(m);
  m.community_channel_id = c!.community_channel_id;
  c!.msgs.push(m);
  for (const k of c!.members) if (k !== req.user) c!.unread[k] = (c!.unread[k] ?? 0) + 1;
  return created(view(m, req.user!, c!));
});
route("POST /api/v1/community/link-previews", (req) => {
  const url = String(req.body.url ?? "").trim();
  if (url.length < 4) return invalid({ url: ["Not a link"] });
  return ok({ preview: cardFor(firstLink(url)) });
});
route("POST /api/v1/community/recognitions", (req) => {
  const to = byId(String(req.body.to_employee_id));
  if (!to) return notFound();
  if (to.user_key === req.user) return invalid({ to_employee_id: ["Choose a colleague"] });
  const general = CHANNELS[1];
  const m = msg("recognition", req.user!, new Date().toISOString(), { body: String(req.body.message || "Thank you for the great work this week.") });
  m.recognition = { to: person(to.user_key), count: 0, mine: false };
  m.community_channel_id = general.community_channel_id;
  general.msgs.push(m);
  return created(view(m, req.user!, general));
});

const located = (id: string) => {
  for (const c of CHANNELS) {
    const m = c.msgs.find((x) => x.community_message_id === id);
    if (m) return { c, m };
  }
  return null;
};
route("PUT /api/v1/community/messages/:id", (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!) || f.m.deleted) return notFound();
  if (f.m._by !== req.user) return fail(403, "NOT_YOURS", "Only its author edits a message");
  const body = String(req.body.body ?? "").trim();
  if (!body) return invalid({ body: ["Write something"] });
  if (f.m.message_type === "text") {
    if (Date.now() - new Date(f.m.sent_at).getTime() >= 15 * 60 * 1000) return fail(409, "EDIT_WINDOW_PASSED", "Too late to edit this message", { body: ["Too late to edit"] });
    f.m.body = body;
    f.m.link = f.m._noLink ? null : cardFor(firstLink(body));
  } else if (f.m.message_type === "poll" && f.m.poll) {
    if (f.m.poll.closed) return fail(409, "POLL_CLOSED", "This poll is closed");
    if (Object.keys(f.m._votes).length) return fail(409, "POLL_HAS_VOTES", "People have voted on this poll", { body: ["Already has votes"] });
    const options = (req.body.options as string[] | undefined) ?? f.m.poll.options.map((o) => o.text);
    f.m.body = body;
    f.m.poll = { ...f.m.poll, question: body, options: options.map((text) => ({ text, votes: 0 })) };
  } else return fail(422, "NOT_EDITABLE", "This kind of message is not edited");
  f.m.edited_at = new Date().toISOString();
  return ok(view(f.m, req.user!, f.c));
});
route("DELETE /api/v1/community/messages/:id", (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!) || f.m.deleted) return notFound();
  if (f.m.message_type === "announcement") return fail(422, "ANNOUNCEMENT_POST", "Announcements are managed from the Announcements tab");
  if (f.m._by !== req.user && !moderates(f.c, req.user!)) return fail(403, "NOT_YOURS", "Only its author or a moderator deletes a message");
  f.m.deleted = true;
  f.m.body = null;
  f.m.document = null;
  f.m.link = null;
  f.m.celebration = null;
  f.m.recognition = null;
  f.m.poll = null;
  return noContent();
});
route("POST /api/v1/community/messages/:id/close", (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!) || f.m.deleted || !f.m.poll) return notFound();
  if (f.m._by !== req.user && !moderates(f.c, req.user!)) return fail(403, "NOT_YOURS", "Only its author or a moderator closes a poll");
  f.m.poll = { ...f.m.poll, closed: true };
  return ok(view(f.m, req.user!, f.c));
});
route("POST /api/v1/community/messages/:id/reactions", (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!)) return notFound();
  f.m._fans = f.m._fans.includes(req.user!) ? f.m._fans.filter((k) => k !== req.user) : [...f.m._fans, req.user!];
  return ok(view(f.m, req.user!, f.c));
});
route("POST /api/v1/community/messages/:id/vote", (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!) || !f.m.poll || f.m.deleted) return notFound();
  if (f.m.poll.closed) return fail(409, "POLL_CLOSED", "This poll is closed");
  const o = Number(req.body.option_index);
  if (!(o >= 0 && o < f.m.poll.options.length)) return invalid({ option_index: ["Not an option"] });
  if (f.m._votes[req.user!] === o) delete f.m._votes[req.user!];
  else f.m._votes[req.user!] = o;
  return ok(view(f.m, req.user!, f.c));
});
route("POST /api/v1/community/messages/:id/transcript", async (req) => {
  const f = located(req.params.id);
  if (!f || !isMember(f.c, req.user!) || f.m.message_type !== "audio") return notFound();
  await new Promise((r) => setTimeout(r, 900));
  f.m.transcript = TRANSCRIPTS[f.m._by ?? ""] ?? "Quick update: all on track for Friday. I will send the details in writing.";
  return ok({ transcript: f.m.transcript });
});

route("GET /api/v1/community/direct", (req) =>
  paged(
    CHANNELS.filter((c) => c.channel_type === "direct" && isMember(c, req.user!) && c.msgs.length > 0)
      .sort((a, b) => String(b.pins.get(req.user!) ?? "").localeCompare(String(a.pins.get(req.user!) ?? "")) || String(b.msgs.at(-1)?.sent_at).localeCompare(String(a.msgs.at(-1)?.sent_at)))
      .map((c) => conversationOut(c, req.user!)),
    req,
    { search: (d) => [d.person.display_name], filters: { unread: (d, v) => (v === "true" ? d.unread > 0 : true) } },
  ),
);
route("POST /api/v1/community/direct", (req) => {
  const p = byId(String(req.body.employee_id));
  if (!p) return notFound();
  const pair = [...new Set([req.user!, p.user_key])];
  let c = CHANNELS.find((x) => x.channel_type === "direct" && x.members.length === pair.length && pair.every((k) => x.members.includes(k)));
  if (!c) {
    c = chan0(`dm-${pair.join("-")}`, pair, [], { channel_type: "direct", admins: [] });
    CHANNELS.push(c);
  }
  return ok(conversationOut(c, req.user!));
});
route("GET /api/v1/community/people", (req) => paged(PEOPLE.filter((p) => p.user_key !== req.user || String(req.query.with_self) === "true").map((p) => person(p.user_key)), req, { search: (p) => [p.display_name, p.department, p.job_title], filters: { with_self: () => true } }));
route("GET /api/v1/community/people/:id/card", (req) => {
  const p = byId(req.params.id);
  if (!p) return notFound();
  const dm = CHANNELS.find((x) => x.channel_type === "direct" && x.members.includes(req.user!) && x.members.includes(p.user_key));
  const media = (dm?.msgs ?? []).filter((m) => m.document);
  const out: ProfileCard = {
    person: person(p.user_key),
    user_id: uid(p.user_key),
    work_email: p.work_email,
    phone: p.phone,
    worksite: p.work_pattern === "remote" ? "Remote" : p.worksite,
    online: ONLINE.has(p.user_key),
    last_seen_at: ONLINE.has(p.user_key) ? null : at(1, "21:14"),
    shared_files: media.filter((m) => m.message_type !== "audio").map((m) => m.document!),
    voice_notes: media.filter((m) => m.message_type === "audio").length,
    shared_channels: CHANNELS.filter((c) => c.channel_type !== "direct" && c.members.includes(p.user_key) && c.members.includes(req.user!)).map((c) => c.name),
  };
  return ok(out);
});

function announcementOut(a: MockAnnouncement): Announcement {
  const audience = a.departments.length ? PEOPLE.filter((p) => a.departments.includes(p.department)).length : PEOPLE.length;
  return {
    announcement_id: a.announcement_id,
    title: a.title,
    body: a.body,
    audience: { kind: a.departments.length ? "departments" : "all", department_ids: a.departments.map((d) => sid(`dept:${d}`)) },
    departments: a.departments,
    status: a.scheduled ? "scheduled" : "published",
    author: person(a.by),
    publish_at: a.scheduled ? a.publish_at : null,
    published_at: a.scheduled ? null : a.publish_at,
    reads: a.scheduled ? 0 : a.read.size,
    audience_size: a.scheduled ? 0 : audience,
    urgency: a.urgency,
  };
}
const poster = (user: string | null) => !!user && ANN_POSTERS.has(user);
const denied = () => fail(403, "CAPABILITY_REQUIRED", "This needs an authority you do not hold");

route("GET /api/v1/community/announcements", (req) => (poster(req.user) ? paged(ANNOUNCEMENTS.map(announcementOut), req, { search: (a) => [a.title, a.body] }) : denied()));
route("GET /api/v1/community/announcements/stats", (req) => {
  if (!poster(req.user)) return denied();
  const all = ANNOUNCEMENTS.map(announcementOut);
  const pub = all.filter((a) => a.status === "published");
  const month = new Date().toISOString().slice(0, 7);
  const out: AnnouncementStats = {
    published: pub.length,
    scheduled: all.length - pub.length,
    average_read: pub.length ? Math.round((pub.reduce((s, a) => s + a.reads / Math.max(1, a.audience_size), 0) * 100) / pub.length) : 0,
    audience: PEOPLE.length,
    this_month: pub.filter((a) => (a.published_at ?? "").slice(0, 7) === month).length,
  };
  return ok(out);
});
route("POST /api/v1/community/announcements", (req) => {
  if (!poster(req.user)) return denied();
  const f: Record<string, string[]> = {};
  if (!String(req.body.title ?? "").trim()) f.title = ["Add a headline"];
  if (!String(req.body.body ?? "").trim()) f.body = ["Write the message"];
  const audience = (req.body.audience as { kind?: string; department_ids?: string[] } | undefined) ?? { kind: "all" };
  if (audience.kind === "departments" && !audience.department_ids?.length) f["audience.department_ids"] = ["Choose a department"];
  const when = req.body.publish_at as string | undefined;
  if (when && when <= new Date().toISOString()) f.publish_at = ["Time already passed"];
  if (Object.keys(f).length) return invalid(f);
  const departments = audience.kind === "departments" ? DEPARTMENTS.filter((d) => audience.department_ids!.includes(sid(`dept:${d}`))) : [];
  const urgency = (req.body.urgency as Announcement["urgency"] | undefined) ?? "normal";
  // The poster has read what they posted (acknowledged it, when urgent).
  const a: MockAnnouncement = { announcement_id: sid(`ann:${Date.now()}`), title: String(req.body.title), body: String(req.body.body), by: req.user!, publish_at: when ?? new Date().toISOString(), scheduled: !!when, departments, read: new Set(when ? [] : [req.user!]), reminded: null, urgency };
  ANNOUNCEMENTS.unshift(a);
  if (!a.scheduled) {
    const m = annMsg(a);
    m.community_channel_id = CHANNELS[0].community_channel_id;
    CHANNELS[0].msgs.push(m);
  }
  return created(announcementOut(a));
});
/** A scheduled one, or the reason it cannot be changed. */
function scheduledAnn(id: string) {
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === id);
  if (!a) return { err: notFound() };
  if (!a.scheduled) return { err: fail(409, "ALREADY_POSTED", "It has already gone out") };
  return { a };
}
route("PUT /api/v1/community/announcements/:id", (req) => {
  if (!poster(req.user)) return denied();
  const { a, err } = scheduledAnn(req.params.id);
  if (!a) return err;
  const f: Record<string, string[]> = {};
  if (!String(req.body.title ?? "").trim()) f.title = ["Add a headline"];
  if (!String(req.body.body ?? "").trim()) f.body = ["Write the message"];
  const audience = (req.body.audience as { kind?: string; department_ids?: string[] } | undefined) ?? { kind: "all" };
  if (audience.kind === "departments" && !audience.department_ids?.length) f["audience.department_ids"] = ["Choose a department"];
  const when = String(req.body.publish_at ?? "");
  if (!when || when <= new Date().toISOString()) f.publish_at = ["Time already passed"];
  if (Object.keys(f).length) return invalid(f);
  a.title = String(req.body.title);
  a.body = String(req.body.body);
  a.publish_at = when;
  if (req.body.urgency) a.urgency = req.body.urgency as Announcement["urgency"];
  a.departments = audience.kind === "departments" ? DEPARTMENTS.filter((d) => audience.department_ids!.includes(sid(`dept:${d}`))) : [];
  return ok(announcementOut(a));
});
route("POST /api/v1/community/announcements/:id/cancel", (req) => {
  if (!poster(req.user)) return denied();
  const { a, err } = scheduledAnn(req.params.id);
  if (!a) return err;
  ANNOUNCEMENTS.splice(ANNOUNCEMENTS.indexOf(a), 1);
  return ok({ ...announcementOut(a), status: "cancelled" as const });
});
route("GET /api/v1/community/announcements/:id/reads", (req) => {
  if (!poster(req.user)) return denied();
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === req.params.id);
  if (!a) return notFound();
  const audience = a.departments.length ? PEOPLE.filter((p) => a.departments.includes(p.department)) : PEOPLE;
  const rows = audience.map((p, i) => {
    const when = a.read.has(p.user_key) ? at(Math.max(0, 3 - (i % 4)), `0${8 + (i % 2)}:${String(10 + i).padStart(2, "0")}`) : null;
    return { person: person(p.user_key), read_at: when, acknowledged_at: a.urgency === "urgent" ? when : null };
  });
  return paged(rows, req, { search: (r) => [r.person.display_name], filters: { read: (r, v) => (v === "read" ? !!r.read_at : !r.read_at) } });
});
route("POST /api/v1/community/announcements/:id/remind", (req) => {
  if (!poster(req.user)) return denied();
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === req.params.id);
  if (!a) return notFound();
  const today = new Date().toISOString().slice(0, 10);
  if (a.reminded === today) return fail(429, "ALREADY_REMINDED", "Already reminded today");
  a.reminded = today;
  return ok({ reminded: PEOPLE.length - a.read.size });
});
route("POST /api/v1/community/announcements/:id/acknowledge", (req) => {
  const a = ANNOUNCEMENTS.find((x) => x.announcement_id === req.params.id && !x.scheduled);
  if (!a || !inAudience(a, req.user!)) return notFound();
  if (a.urgency !== "urgent") return fail(422, "NOT_URGENT", "Only an urgent announcement is acknowledged");
  a.read.add(req.user!);
  return noContent();
});
