"use strict";
/**
 * Calendar invitations (RFC 5545): M2 calendar events and M4 interview invites, sent
 * as a .ics attachment with system mail so Outlook, Gmail and phones add them.
 *
 *   const text = ics.event({
 *     uid: `interview-${id}@mycityapp.io`,      // stable: an update or cancel uses the same uid
 *     sequence: 0,                               // +1 on every update
 *     start: "2026-10-20T10:00:00+01:00",        // an instant; written in UTC
 *     end:   "2026-10-20T11:00:00+01:00",
 *     summary: "Interview: Partnerships Associate",
 *     description: "Panel: ...",
 *     location: "MyCity Hub, Lekki",
 *     organizer: { name: "MyCity Recruitment", email: "recruitment@mycityapp.io" },
 *     attendees: [{ name: "Ada Obi", email: "ada@example.com" }],
 *     method: "REQUEST",                         // or "CANCEL"
 *   });
 *
 * Times are written in UTC (…Z), which every client converts to the reader's zone;
 * Lagos has no daylight saving, so nothing is lost. Text is escaped and lines folded
 * at 75 octets, as the standard requires; lines end in CRLF.
 */
const METHODS = new Set(["REQUEST", "CANCEL", "PUBLISH"]);

/** Escape a TEXT value: backslash, semicolon, comma, newline. */
function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (UTF-8 safe). */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** "20261020T090000Z" */
function utc(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime()))
    throw new Error(`ics: "${instant}" is not a date and time`);
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

const mailto = (email) => {
  const e = String(email || "").trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(e))
    throw new Error(`ics: "${email}" is not an email address`);
  return `mailto:${e}`;
};
const cn = (name) =>
  name ? `;CN="${String(name).replace(/["\r\n]/g, "")}"` : "";

/**
 * @param {object} e  see the file header
 * @returns {string} the .ics file text
 */
function event(e) {
  const method = e.method || "REQUEST";
  if (!METHODS.has(method))
    throw new Error(`ics: method is REQUEST, CANCEL or PUBLISH`);
  if (!e.uid || !/^[\w.@-]+$/.test(e.uid))
    throw new Error("ics: a stable uid is required (letters, digits, . @ - _)");
  if (new Date(e.end) <= new Date(e.start))
    throw new Error("ics: end must be after start");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//MyCity App//ERP//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${Number.isInteger(e.sequence) ? e.sequence : 0}`,
    `DTSTAMP:${utc(e.stamp || new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${String(e.url).replace(/[\r\n]/g, "")}`);
  if (e.organizer)
    lines.push(`ORGANIZER${cn(e.organizer.name)}:${mailto(e.organizer.email)}`);
  for (const a of e.attendees || []) {
    lines.push(
      `ATTENDEE${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:${mailto(a.email)}`,
    );
  }
  lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  if (e.reminderMinutes) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(e.summary)}`,
      `TRIGGER:-PT${Math.round(e.reminderMinutes)}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** As a mail attachment (system-mail.service send({ attachments })). */
function attachment(e, filename = "invite.ics") {
  return {
    filename,
    content: event(e),
    contentType: `text/calendar; charset=utf-8; method=${e.method || "REQUEST"}`,
  };
}

module.exports = { event, attachment, escapeText, fold, utc };
