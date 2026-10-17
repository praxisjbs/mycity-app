"use strict";
/**
 * The six canonical folders (mailbox.md §4) and how a server's folders map onto them:
 * by the special-use flag first (RFC 6154), then INBOX by path, then by the folder's own
 * name in the languages MyCity's correspondents use. The first folder to claim a kind
 * keeps it. Folders that map to none are not synced.
 */
const KINDS = ["inbox", "sent", "drafts", "archive", "spam", "trash"];

const BY_FLAG = {
  "\\inbox": "inbox",
  "\\sent": "sent",
  "\\drafts": "drafts",
  "\\junk": "spam",
  "\\archive": "archive",
  "\\trash": "trash",
};

const BY_NAME = [
  [/^inbox$/i, "inbox"],
  [/^(sent|sent[\s._-]*items|sent[\s._-]*mail|sent[\s._-]*messages)$/i, "sent"],
  [/^(drafts?)$/i, "drafts"],
  [/^(spam|junk|junk[\s._-]*e-?mail|bulk[\s._-]*mail)$/i, "spam"],
  [/^(archives?|archived)$/i, "archive"],
  [/^(trash|deleted|deleted[\s._-]*items|deleted[\s._-]*messages|bin)$/i, "trash"],
];

/** The last segment of a folder path ("INBOX.Sent" → "Sent"). */
function leafName(path, delimiter) {
  const parts = delimiter ? String(path).split(delimiter) : [String(path)];
  return parts[parts.length - 1];
}

/** The canonical kind of one server folder, or null. */
function kindOf(folder) {
  for (const flag of folder.flags || []) {
    const k = BY_FLAG[String(flag).toLowerCase()];
    if (k) return k;
  }
  if (folder.specialUse && BY_FLAG[String(folder.specialUse).toLowerCase()]) return BY_FLAG[String(folder.specialUse).toLowerCase()];
  if (String(folder.path).toUpperCase() === "INBOX") return "inbox";
  const leaf = leafName(folder.path, folder.delimiter);
  for (const [re, k] of BY_NAME) if (re.test(leaf)) return k;
  return null;
}

/** Server folders → rows to keep: each kind claimed once, canonical folders first. */
function mapFolders(list) {
  const taken = new Set();
  const rows = [];
  for (const f of list || []) {
    let kind = kindOf(f);
    if (kind && taken.has(kind)) kind = null;
    if (kind) taken.add(kind);
    rows.push({ remote_key: f.path, name: leafName(f.path, f.delimiter), special_use: f.specialUse || null, kind });
  }
  return rows.sort((a, b) => (a.kind ? KINDS.indexOf(a.kind) : 99) - (b.kind ? KINDS.indexOf(b.kind) : 99));
}

/** Where to resume a folder: from the last UID, unless the server renumbered it. */
function cursorFor(folder, uidValidity) {
  const known = folder.uidvalidity !== null && folder.uidvalidity !== undefined;
  const same = known && Number(folder.uidvalidity) === Number(uidValidity);
  return { last_uid: same ? Number(folder.last_uid || 0) : 0, rescanned: !same && known };
}

module.exports = { KINDS, kindOf, mapFolders, cursorFor, leafName };
