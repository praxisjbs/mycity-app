import type { MailAddress, MailAttachment, MailDraftSave, MailFolder, MailMessage, MailSend, ThreadRow } from "@/api/types/mailbox";
import { at, created, fail, invalid, notFound, ok, paged, route, sid, uuid } from "../core";
import { byKey } from "../data/people";
import { UPLOADS } from "../uploads";

/** Each signed-in person's own mailbox, built on first use. Nobody reaches another's. */
interface MThread { thread_id: string; folder: MailFolder; subject: string; unread: boolean; messages: MailMessage[]; draft_id: string | null; scheduled: { queue_id: string; release_at: string } | null; _prev?: MailFolder }
interface MBox { address: string; name: string; threads: MThread[]; drafts: Map<string, { draft_id: string; save: MailDraftSave; attachments: MailAttachment[]; updated_at: string; thread_id: string }>; sends: Set<string>; status: "connected" | "needs_reconnect" | "disconnected"; last_sync_at: string }
const BOXES = new Map<string, MBox>();

const A = (name: string | null, address: string): MailAddress => ({ name, address });
const att = (name: string, kb: number, mime = "application/pdf"): MailAttachment => ({ attachment_id: sid(`att:${name}`), document_id: sid(`doc:${name}`), file_name: name, size_bytes: kb * 1024, mime_type: mime });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const html = (...paras: string[]) => paras.map((p) => `<p>${p}</p>`).join("");

type Seed = [folder: MailFolder, from: MailAddress, subject: string, days: number, hm: string, unread: boolean, body: string | null, attachments: MailAttachment[], to?: MailAddress[]];

function seed(first: string, me: MailAddress): Seed[] {
  return [
    ["inbox", A("MTN Partnerships", "o.adesanya@mtn.ng"), "Ember to Remember, venue confirmations", 0, "09:14", true, html(`${first},`, "Following our call, brand have signed off on the placement for the Lagos leg. The eight venues below are confirmed for the 14th onwards. Two are still awaiting a site visit from your studio team.", "Could you send the final venue list by Monday so we can brief the activation agency?", "Olumide Adesanya<br>Head of Brand Partnerships, MTN Nigeria"), [att("ember-venues-lagos.xlsx", 84, XLSX), att("placement-signoff.pdf", 1126)]],
    ["inbox", A("Providus Bank", "i.okeke@providusbank.com"), "Re: Sponsorship logo placement", 0, "08:47", true, html(`Dear ${first},`, "Thank you for the draft. We would like the Providus mark to appear on the ticket confirmation email as well as the campaign assets, as headline sponsor.", "Is that within scope of the agreement signed on 22 September?", "Ifeanyi Okeke<br>Head of Brand, Providus Bank"), []],
    ["inbox", A("Adaeze Nnamdi", "adaeze.n@example.com"), "Re: Interview on Monday", 0, "08:02", true, html("Good morning,", "Thank you for the invitation. Monday at 11:00 works for me. I will join from Lagos.", "I have attached the case study response as requested.", "Adaeze"), [att("partnership-brief-response.pdf", 620)]],
    ["inbox", A("Lagos State Tourism", "tourism@lagosstate.gov.ng"), "Request for event listing", 1, "15:20", false, html("Madam,", "Kindly find attached the schedule of state tourism events for the fourth quarter, for listing on the application.", "Our legal team has also returned the draft MOU with comments on the data sharing clauses. We will revert formally next week.", "For the Director of Tourism"), [att("q4-tourism-events.pdf", 2458)]],
    ["inbox", A("JBS Praxis", "asah.tomf@gmail.com"), "Milestone 1 documents required", 1, "11:05", false, html(`Dear ${first},`, "Thank you for Thursday’s session. To start Milestone 1 we need the staff list with departments and line managers, the organogram, a sample query letter, and your real salary structure.", "The two that block us are the staff list and the letter samples. Everything else we can seed and replace.", "Tom-Blake Asaah<br>Managing Partner, JBS Praxis"), [att("requirements-m1.pdf", 310)]],
    ["inbox", A("Filmhouse Cinemas", "k.oyelaran@filmhouseng.com"), "Partnership proposal follow up", 6, "10:40", false, html(`Hi ${first},`, "We have reviewed the listings proposal. Rather than a flat listing fee, we would prefer a revenue share on tickets driven through the app. Happy to model it together.", "Kemi Oyelaran<br>Head of Partnerships"), []],
    ["inbox", A("Eko Hotels", "t.akinwale@ekohotels.com"), "Out of office", 8, "07:12", false, html("I am away from the office until the 20th with limited access to email. For commercial matters please contact our reservations desk.", "Tunde Akinwale"), []],
    ["sent", me, "Staff list and organogram", 1, "16:02", false, html("Tom-Blake,", "Attached is the staff list with departments and line managers as at today, and the organogram. Twenty-five people across six departments.", "The salary structure is with the CEO. Sample letters I should have to you by Tuesday.", first), [att("staff-list.xlsx", 46, XLSX), att("organogram.pdf", 880)], [A("Tom-Blake Asaah", "asah.tomf@gmail.com")]],
    ["sent", me, "Re: Sponsorship logo placement", 1, "12:30", false, html("Ifeanyi,", "Yes, headline billing covers the ticket confirmation email. I have raised it as a task against the agreement so it is not lost between us.", first), [], [A("Ifeanyi Okeke", "i.okeke@providusbank.com")]],
    ["sent", me, "October payroll preview for sign off", 7, "17:45", false, html("Ifeoma,", "October preview attached. Twenty-five staff, ₦11.42M gross, ₦11.36M net. The only deduction is Bashir’s ₦12,500, accepted from the August warning.", first), [att("payroll-preview-oct.pdf", 190)], [A("Ifeoma Chukwu", "ifeoma@mycityapp.io")]],
    ["sent", me, "Offer, Content Producer", 8, "14:10", false, html("Chiamaka,", "We are delighted to offer you the Content Producer role. The offer is attached and signable from the link. It expires on the 22nd.", first), [att("offer-OFF-0018.pdf", 240)], [A("Chiamaka Obi", "chiamaka.obi@example.com")]],
    ["archive", A("MTN Nigeria", "legal@mtn.ng"), "Signed MOU, countersigned copy", 560, "10:00", false, html(`${first},`, "Please find the countersigned MOU attached, executed 13 March 2025. The renewal date is 13 March 2027.", "MTN Legal"), [att("MOU-0004-countersigned.pdf", 1843)]],
    ["archive", A("Greenlife Pharmaceuticals", "c.nnadi@greenlifepharma.com"), "Lonart-DS partnership terms", 30, "13:22", false, html("Good afternoon,", "Thank you for meeting us. Please send the formal proposal for the four-city activation and we will take it to brand.", "Chuka Nnadi"), []],
    ["archive", A("People", "people@mycityapp.io"), "Q3 review cycle closed", 14, "09:00", false, html("The Q3 cycle is closed. Eighteen of twenty-five reviews were completed, average manager rating 3.9.", "Q4 opens on the 20th."), []],
    ["spam", A(null, "noreply@unknown.invalid"), "Congratulations you have won", 6, "03:11", false, null, []],
    ["spam", A(null, "noreply@unknown.invalid"), "Business proposal urgent", 9, "22:48", false, null, []],
    ["trash", A("Zoom", "no-reply@zoom.us"), "Your recording is ready", 7, "18:30", false, html("Your recording of “Partnerships standup” is ready.", "Deleted, recoverable for 30 days."), []],
    ["trash", A("Newsletter", "hello@newsletter.example"), "Weekly roundup", 11, "06:00", false, html("This week in events across Lagos, Abuja and Enugu.", "Deleted, recoverable for 30 days."), []],
  ];
}

function boxOf(user: string): MBox {
  let b = BOXES.get(user);
  if (b) return b;
  const p = byKey(user)!;
  const me = A(p.display_name, p.work_email);
  const first = p.display_name.split(" ")[0];
  const threads: MThread[] = seed(first, me).map(([folder, from, subject, days, hm, unread, body, attachments, to], i) => ({
    thread_id: sid(`mail:${user}:${i}`),
    folder,
    subject,
    unread,
    draft_id: null,
    scheduled: null,
    messages: [{ message_id: sid(`mailmsg:${user}:${i}`), from, to: to ?? [me], cc: [], sent_at: at(days, hm), body_html: body, attachments }],
  }));
  b = { address: me.address, name: me.name!, threads, drafts: new Map(), sends: new Set(), status: "connected", last_sync_at: new Date().toISOString() };
  const d1 = { to: [], cc: [], bcc: [], subject: "Enugu launch brief", body_html: html("The Enugu leg runs from the 22nd. Two content roles start on the 20th, so the brief needs to be ready before they arrive. Three locations, two shoot days, Emeka producing."), attachment_ids: [] };
  const d2 = { to: ["bashir@mycityapp.io"], cc: [], bcc: [], subject: "Re: Eko Hotels, 34 days quiet", body_html: html("Bashir, the inactivity alert on Eko has been open for four days and the one on Kano for twenty-two. Can we agree today whether to re-engage or close them?"), attachment_ids: [] };
  [[d1, 0, "10:02"], [d2, 1, "17:20"]].forEach(([save, days, hm], i) => saveDraft(b!, sid(`draft:${user}:${i}`), save as MailDraftSave, [], at(days as number, hm as string)));
  BOXES.set(user, b);
  return b;
}

function saveDraft(b: MBox, draft_id: string, save: MailDraftSave, attachments: MailAttachment[], when = new Date().toISOString()) {
  const prev = b.drafts.get(draft_id);
  const thread_id = prev?.thread_id ?? sid(`draftthread:${draft_id}`);
  b.drafts.set(draft_id, { draft_id, save, attachments, updated_at: when, thread_id });
  let t = b.threads.find((x) => x.thread_id === thread_id);
  if (!t) {
    t = { thread_id, folder: "drafts", subject: "", unread: false, draft_id, scheduled: null, messages: [] };
    b.threads.push(t);
  }
  t.subject = save.subject;
  t.messages = [{ message_id: sid(`draftmsg:${draft_id}`), from: A(b.name, b.address), to: save.to.map((x) => A(null, x)), cc: save.cc.map((x) => A(null, x)), sent_at: when, body_html: save.body_html, attachments }];
  return b.drafts.get(draft_id)!;
}

const text = (h: string | null) => (h ?? "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const last = (t: MThread) => t.messages[t.messages.length - 1];
function row(t: MThread): ThreadRow {
  const m = last(t);
  const outbound = t.folder === "sent" || t.folder === "drafts";
  return {
    thread_id: t.thread_id, folder: t.folder, subject: t.subject || "(no subject)",
    party: outbound ? m?.to[0] ?? null : m?.from ?? null,
    snippet: t.folder === "spam" ? "Marked as spam by the filter." : text(m?.body_html ?? "").slice(0, 140),
    last_message_at: m?.sent_at ?? new Date().toISOString(), unread: t.unread, has_attachment: t.messages.some((x) => x.attachments.length > 0),
    message_count: t.messages.length, draft_id: t.draft_id, scheduled: t.scheduled,
  };
}
const fromUpload = (id: string): MailAttachment => ({ file_name: "attachment", size_bytes: 0, mime_type: "application/octet-stream", ...UPLOADS.get(id), attachment_id: id, document_id: id });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const findThread = (user: string, id: string) => boxOf(user).threads.find((t) => t.thread_id === id);

route("GET /api/v1/mailbox/connection", (req) => {
  const b = boxOf(req.user!);
  return ok({ connection_id: sid(`conn:${req.user}`), email_address: b.address, status: b.status, last_sync_at: b.last_sync_at, last_error_code: null });
});
route("POST /api/v1/mailbox/connection/sync", (req) => {
  const b = boxOf(req.user!);
  b.last_sync_at = new Date().toISOString();
  return ok({ connection_id: sid(`conn:${req.user}`), email_address: b.address, status: b.status, last_sync_at: b.last_sync_at, last_error_code: null });
});
route("GET /api/v1/mailbox/threads", (req) => {
  const b = boxOf(req.user!);
  const rows = b.threads.map(row).sort((x, y) => y.last_message_at.localeCompare(x.last_message_at));
  return paged(rows, req, { search: (r) => [r.subject, r.party?.name, r.party?.address, r.snippet], filters: { folder: (r, v) => r.folder === v, unread: (r, v) => (v === "true" ? r.unread : true) } });
});
route("GET /api/v1/mailbox/threads/:id", (req) => {
  const t = findThread(req.user!, req.params.id);
  return t ? ok({ thread_id: t.thread_id, folder: t.folder, subject: t.subject || "(no subject)", messages: t.messages }) : notFound();
});
route("POST /api/v1/mailbox/threads/:id/read", (req) => {
  const t = findThread(req.user!, req.params.id);
  if (!t) return notFound();
  t.unread = false;
  return ok(null);
});
route("POST /api/v1/mailbox/threads/:id/move", (req) => {
  const t = findThread(req.user!, req.params.id);
  if (!t) return notFound();
  const to = String(req.body.to) as MailFolder;
  if (!["inbox", "archive", "spam", "trash"].includes(to)) return invalid({ to: ["must be inbox, archive, spam or trash"] });
  if (t.folder === "drafts") return fail(409, "IS_DRAFT", "A draft is discarded, not moved.");
  t._prev = t.folder;
  t.folder = to === "inbox" && t._prev === "trash" && t.messages[0]?.from.address === boxOf(req.user!).address ? "sent" : to;
  return ok(row(t));
});
route("POST /api/v1/mailbox/folders/:kind/empty", (req) => {
  const b = boxOf(req.user!);
  const kind = req.params.kind;
  if (kind !== "spam" && kind !== "trash") return invalid({ kind: ["Only spam and trash can be emptied"] });
  const before = b.threads.length;
  b.threads = b.threads.filter((t) => t.folder !== kind);
  return ok({ removed: before - b.threads.length });
});
route("GET /api/v1/mailbox/drafts/:id", (req) => {
  const d = boxOf(req.user!).drafts.get(req.params.id);
  return d ? ok({ draft_id: d.draft_id, ...d.save, attachments: d.attachments, updated_at: d.updated_at }) : notFound();
});
route("PUT /api/v1/mailbox/drafts/:id", (req) => {
  const b = boxOf(req.user!);
  const s = req.body as unknown as MailDraftSave;
  const prev = b.drafts.get(req.params.id);
  const known = new Map([...(prev?.attachments ?? [])].map((a) => [a.attachment_id, a]));
  const attachments = (s.attachment_ids ?? []).map((id) => known.get(id) ?? fromUpload(id));
  const d = saveDraft(b, req.params.id, { to: s.to ?? [], cc: s.cc ?? [], bcc: s.bcc ?? [], subject: s.subject ?? "", body_html: s.body_html ?? "", attachment_ids: s.attachment_ids ?? [] }, attachments);
  return ok({ draft_id: d.draft_id, ...d.save, attachments: d.attachments, updated_at: d.updated_at });
});
route("DELETE /api/v1/mailbox/drafts/:id", (req) => {
  const b = boxOf(req.user!);
  const d = b.drafts.get(req.params.id);
  if (!d) return notFound();
  b.drafts.delete(req.params.id);
  b.threads = b.threads.filter((t) => t.thread_id !== d.thread_id);
  return { status: 204, body: null };
});
route("POST /api/v1/mailbox/messages", (req) => {
  const b = boxOf(req.user!);
  if (!req.idempotency_key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "This request needs an Idempotency-Key header.");
  if (b.sends.has(req.idempotency_key)) return fail(409, "ALREADY_SENT", "This message was already sent.");
  const s = req.body as unknown as MailSend;
  const all = [...(s.to ?? []), ...(s.cc ?? []), ...(s.bcc ?? [])];
  if (!s.to?.length) return invalid({ to: ["Add at least one recipient"] });
  const bad = all.find((x) => !EMAIL.test(x));
  if (bad) return invalid({ to: [`${bad} is not an email address`] });
  if (s.release_at && new Date(s.release_at).getTime() <= Date.now()) return invalid({ release_at: ["That time has already passed"] });
  b.sends.add(req.idempotency_key);
  const prev = s.draft_id ? b.drafts.get(s.draft_id) : undefined;
  const attachments = (s.attachment_ids ?? []).map((id) => prev?.attachments.find((a) => a.attachment_id === id) ?? fromUpload(id));
  const queue_id = uuid();
  if (s.release_at) {
    /* A scheduled message waits in Drafts, labelled Scheduled, until it is released. */
    const draft_id = s.draft_id ?? uuid();
    const d = saveDraft(b, draft_id, { to: s.to, cc: s.cc ?? [], bcc: s.bcc ?? [], subject: s.subject, body_html: s.body_html, attachment_ids: s.attachment_ids ?? [] }, attachments);
    const t = b.threads.find((x) => x.thread_id === d.thread_id)!;
    t.scheduled = { queue_id, release_at: s.release_at };
    return created({ queue_id, status: "queued", release_at: s.release_at });
  }
  if (s.draft_id && prev) {
    b.drafts.delete(s.draft_id);
    b.threads = b.threads.filter((t) => t.thread_id !== prev.thread_id);
  }
  b.threads.push({
    thread_id: uuid(), folder: "sent", subject: s.subject || "(no subject)", unread: false, draft_id: null, scheduled: null,
    messages: [{ message_id: uuid(), from: A(b.name, b.address), to: s.to.map((x) => A(null, x)), cc: (s.cc ?? []).map((x) => A(null, x)), sent_at: new Date().toISOString(), body_html: s.body_html || "<p></p>", attachments }],
  });
  return created({ queue_id, status: "sent", release_at: null });
});
route("POST /api/v1/mailbox/queue/:id/cancel", (req) => {
  const t = boxOf(req.user!).threads.find((x) => x.scheduled?.queue_id === req.params.id);
  if (!t) return notFound();
  t.scheduled = null;
  return ok({ queue_id: req.params.id, status: "cancelled", release_at: null });
});
