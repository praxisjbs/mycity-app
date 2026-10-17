"use strict";
/**
 * Recognition (MILESTONES A19): a thumbs up for a colleague from the ＋ beside the
 * composer, manager to report, peer to peer or upward. It always posts to #general so
 * everyone sees it. No rewards, no voting, no employee of the month.
 *
 * A note left blank is written by the system (community.md §6), picked from a short list
 * by the colleague's id so the same person is not thanked in the same words every time.
 */
const NOTES = [
  "Thank you for the great work this week.",
  "Thank you for going the extra mile.",
  "Thank you for making the team's work easier.",
];

/** A stable pick from a list by a string key. */
function pick(key, list) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

const noteFor = (employeeId) => pick(`${employeeId}:${new Date().toISOString().slice(0, 10)}`, NOTES);

module.exports = { NOTES, pick, noteFor };
