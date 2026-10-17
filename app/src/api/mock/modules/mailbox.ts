import type { MailAttachment, MailDraftSave, MailFolder, MailMessage, MailSend, ThreadRow } from "@/api/types/mailbox";
import type { DocumentRef } from "@/api/types/common";
import { at, created, fail, invalid, noContent, notFound, ok, paged, route, sid, uuid } from "../core";
import { byKey } from "../data/people";
import { UPLOADS } from "../uploads";

/**
 * Each signed-in person's own mailbox on the mock, in the contract's shapes
 * (packages/contract/schemas/mailbox.js). Laptops and CI only (F12). Nobody reaches
 * another's mail. The mailbox starts connected so the screens have mail to show;
 * disconnecting shows the Connect sheet, and any password but "wrong" connects.
 */
type MailAddress = MailMessage["from"];
interface MThread { mail_thread_id: string; folder: MailFolder; subject: string; unread: boolean; messages: MailMessage[] }
interface MDraft { mail_draft_id: string; save: MailDraftSave; attachments: DocumentRef[]; updated_at: string; scheduled: { mail_send_queue_id: string; release_at: string } | null }
interface MBox { address: string; name: string; threads: MThread[]; drafts: Map<string, MDraft>; status: "connected" | "needs_reconnect" | "disconnected"; last_synced_at: string }
const BOXES = new Map<string, MBox>();

const A = (name: string | null, address: string): MailAddress => ({ name, address });
const att = (name: string, kb: number, mime = "application/pdf"): MailAttachment => ({ mail_attachment_id: sid(`att:${name}`), document_id: sid(`doc:${name}`), file_name: name, size_bytes: kb * 1024, mime_type: mime });
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
    mail_thread_id: sid(`mail:${user}:${i}`),
    folder,
    subject,
    unread,
    messages: [{ mail_message_id: sid(`mailmsg:${user}:${i}`), from, to: (to ?? [me]).map((x) => x.address), cc: [], sent_at: at(days, hm), body_html: folder === "spam" ? null : body, attachments }],
  }));
  b = { address: me.address, name: me.name!, threads, drafts: new Map(), status: "connected", last_synced_at: new Date().toISOString() };
  const blank: MailDraftSave = { to_addresses: [], cc_addresses: [], bcc_addresses: [], subject: "", body_html: "", document_ids: [], in_reply_to: null };
  const d1 = { ...blank, subject: "Enugu launch brief", body_html: html("The Enugu leg runs from the 22nd. Two content roles start on the 20th, so the brief needs to be ready before they arrive. Three locations, two shoot days, Emeka producing.") };
  const d2 = { ...blank, to_addresses: ["bashir@mycityapp.io"], subject: "Re: Eko Hotels, 34 days quiet", body_html: html("Bashir, the inactivity alert on Eko has been open for four days and the one on Kano for twenty-two. Can we agree today whether to re-engage or close them?") };
  [[d1, 0, "10:02"], [d2, 1, "17:20"]].forEach(([save, days, hm], i) => b!.drafts.set(sid(`draft:${user}:${i}`), { mail_draft_id: sid(`draft:${user}:${i}`), save: save as MailDraftSave, attachments: [], updated_at: at(days as number, hm as string), scheduled: null }));
  BOXES.set(user, b);
  return b;
}

const text = (h: string | null) => (h ?? "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const last = (t: MThread) => t.messages[t.messages.length - 1];
function row(t: MThread): ThreadRow {
  const m = last(t);
  return {
    mail_thread_id: t.mail_thread_id, folder: t.folder, subject: t.subject || "(no subject)",
    party: t.folder === "sent" ? (m?.to[0] ? A(null, m.to[0]) : null) : m?.from ?? null,
    snippet: t.folder === "spam" ? "" : text(m?.body_html ?? "").slice(0, 140),
    last_message_at: m?.sent_at ?? new Date().toISOString(), unread: t.unread, has_attachment: t.messages.some((x) => x.attachments.length > 0),
    message_count: t.messages.length, mail_draft_id: null, scheduled: null,
  };
}
function draftRow(d: MDraft): ThreadRow {
  return {
    mail_thread_id: d.mail_draft_id, folder: "drafts", subject: d.save.subject || "(no subject)",
    party: d.save.to_addresses[0] ? A(null, d.save.to_addresses[0]) : null, snippet: text(d.save.body_html).slice(0, 140),
    last_message_at: d.updated_at, unread: false, has_attachment: d.attachments.length > 0, message_count: 0,
    mail_draft_id: d.mail_draft_id, scheduled: d.scheduled,
  };
}
const draftOut = (d: MDraft) => ({ mail_draft_id: d.mail_draft_id, ...d.save, attachments: d.attachments, updated_at: d.updated_at });
const docOf = (id: string): DocumentRef => UPLOADS.get(id) ?? { document_id: id, file_name: "attachment", size_bytes: 0, mime_type: "application/octet-stream" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const live = (user: string) => {
  const b = boxOf(user);
  return b.status === "disconnected" ? null : b;
};
const findThread = (user: string, id: string) => live(user)?.threads.find((t) => t.mail_thread_id === id);
const connection = (user: string) => {
  const b = boxOf(user);
  return b.status === "disconnected"
    ? { mail_account_id: null, email: null, status: "disconnected", last_synced_at: null, last_error_code: null }
    : { mail_account_id: sid(`acct:${user}`), email: b.address, status: b.status, last_synced_at: b.last_synced_at, last_error_code: b.status === "needs_reconnect" ? "MAIL_AUTH_FAILED" : null };
};
const noMailbox = () => fail(409, "NO_MAILBOX", "Connect your mailbox first");

route("GET /api/v1/mailbox/connection", (req) => ok(connection(req.user!)));
route("POST /api/v1/mailbox/connection", (req) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return invalid({ email: ["Not an email address"] });
  if (/@(gmail|outlook|hotmail|yahoo)\./.test(email)) return invalid({ email: ["Use your company address"] });
  if (req.body.password === "wrong") return fail(422, "MAIL_AUTH_FAILED", "The mail server refused the password", { password: ["Password refused"] });
  const b = boxOf(req.user!);
  b.status = "connected";
  b.last_synced_at = new Date().toISOString();
  return ok(connection(req.user!));
});
route("POST /api/v1/mailbox/connection/disconnect", (req) => {
  boxOf(req.user!).status = "disconnected";
  return ok(connection(req.user!));
});
route("POST /api/v1/mailbox/connection/sync", (req) => {
  const b = live(req.user!);
  if (!b) return noMailbox();
  b.last_synced_at = new Date().toISOString();
  return ok(connection(req.user!));
});
route("GET /api/v1/mailbox/threads", (req) => {
  const b = live(req.user!);
  if (!b) return noMailbox();
  const folder = req.query.folder || "inbox";
  const rows = folder === "drafts" ? [...b.drafts.values()].map(draftRow) : b.threads.filter((t) => t.folder === folder).map(row);
  rows.sort((x, y) => y.last_message_at.localeCompare(x.last_message_at));
  return paged(rows, req, { search: (r) => [r.subject, r.party?.name, r.party?.address, r.snippet], filters: { folder: () => true, unread: (r, v) => (v === "true" ? r.unread : true) } });
});
route("GET /api/v1/mailbox/threads/:id", (req) => {
  const t = findThread(req.user!, req.params.id);
  return t ? ok({ mail_thread_id: t.mail_thread_id, folder: t.folder, subject: t.subject || "(no subject)", messages: t.messages }) : notFound();
});
route("POST /api/v1/mailbox/threads/:id/read", (req) => {
  const t = findThread(req.user!, req.params.id);
  if (!t) return notFound();
  t.unread = false;
  return noContent();
});
route("POST /api/v1/mailbox/threads/:id/move", (req) => {
  const t = findThread(req.user!, req.params.id);
  if (!t) return notFound();
  const to = String(req.body.to) as MailFolder;
  if (!["inbox", "archive", "spam", "trash"].includes(to)) return invalid({ to: ["Not a folder"] });
  t.folder = to;
  return noContent();
});
route("POST /api/v1/mailbox/folders/:kind/empty", (req) => {
  const b = live(req.user!);
  if (!b) return noMailbox();
  const kind = req.params.kind;
  if (kind !== "spam" && kind !== "trash") return notFound();
  const before = b.threads.length;
  b.threads = b.threads.filter((t) => t.folder !== kind);
  return ok({ removed: before - b.threads.length });
});
route("GET /api/v1/mailbox/drafts/:id", (req) => {
  const d = live(req.user!)?.drafts.get(req.params.id);
  return d ? ok(draftOut(d)) : notFound();
});
route("PUT /api/v1/mailbox/drafts/:id", (req) => {
  const b = live(req.user!);
  if (!b) return noMailbox();
  const s = req.body as unknown as MailDraftSave;
  const save: MailDraftSave = { to_addresses: s.to_addresses ?? [], cc_addresses: s.cc_addresses ?? [], bcc_addresses: s.bcc_addresses ?? [], subject: s.subject ?? "", body_html: s.body_html ?? "", document_ids: s.document_ids ?? [], in_reply_to: s.in_reply_to ?? null };
  const prev = b.drafts.get(req.params.id);
  const d: MDraft = { mail_draft_id: req.params.id, save, attachments: save.document_ids.map(docOf), updated_at: new Date().toISOString(), scheduled: prev?.scheduled ?? null };
  b.drafts.set(d.mail_draft_id, d);
  return ok(draftOut(d));
});
route("DELETE /api/v1/mailbox/drafts/:id", (req) => {
  live(req.user!)?.drafts.delete(req.params.id);
  return noContent();
});
route("POST /api/v1/mailbox/messages", (req) => {
  const b = live(req.user!);
  if (!b) return noMailbox();
  const s = req.body as unknown as MailSend;
  if (!s.to_addresses?.length) return invalid({ to_addresses: ["Add a recipient"] });
  const bad = [...s.to_addresses, ...(s.cc_addresses ?? []), ...(s.bcc_addresses ?? [])].find((x) => !EMAIL.test(x));
  if (bad) return invalid({ to_addresses: ["Not an email address"] });
  if (s.release_at && new Date(s.release_at).getTime() <= Date.now()) return invalid({ release_at: ["Time already passed"] });
  const attachments = (s.document_ids ?? []).map(docOf);
  const queue = uuid();
  if (s.release_at) {
    /* A scheduled message waits in Drafts, labelled Scheduled, until it is released. */
    const save: MailDraftSave = { to_addresses: s.to_addresses, cc_addresses: s.cc_addresses ?? [], bcc_addresses: s.bcc_addresses ?? [], subject: s.subject ?? "", body_html: s.body_html ?? "", document_ids: s.document_ids ?? [], in_reply_to: s.in_reply_to ?? null };
    b.drafts.set(s.mail_draft_id, { mail_draft_id: s.mail_draft_id, save, attachments, updated_at: new Date().toISOString(), scheduled: { mail_send_queue_id: queue, release_at: s.release_at } });
    return created({ mail_send_queue_id: queue, status: "queued", release_at: s.release_at });
  }
  b.drafts.delete(s.mail_draft_id);
  const now = new Date().toISOString();
  b.threads.push({
    mail_thread_id: uuid(), folder: "sent", subject: s.subject || "(no subject)", unread: false,
    messages: [{ mail_message_id: uuid(), from: A(b.name, b.address), to: s.to_addresses, cc: s.cc_addresses ?? [], sent_at: now, body_html: s.body_html || "<p></p>", attachments: attachments.map((d) => ({ ...d, mail_attachment_id: d.document_id })) }],
  });
  return created({ mail_send_queue_id: queue, status: "sent", release_at: now });
});
route("POST /api/v1/mailbox/queue/:id/cancel", (req) => {
  const d = [...(live(req.user!)?.drafts.values() ?? [])].find((x) => x.scheduled?.mail_send_queue_id === req.params.id);
  if (!d) return fail(409, "ALREADY_SENT", "It has already gone");
  const release = d.scheduled!.release_at;
  d.scheduled = null;
  return ok({ mail_send_queue_id: req.params.id, status: "cancelled", release_at: release });
});
