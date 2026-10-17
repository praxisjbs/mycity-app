"use strict";
/**
 * ⌘K for Staff Community: published announcements, by headline and text. Channels and
 * direct conversations are not offered here: membership decides who may see one, and a
 * search provider is gated by the module grant alone (route-map.js says so on each type).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "announcement",
  module: "community",
  label: "Announcements",
  words: ["announcement", "notice", "memo"],
  from: "announcement a",
  key: "a.announcement_id",
  columns: ["a.title", "a.body"],
  select: "a.announcement_id AS id, a.title AS title, left(a.body, 120) AS sub",
  where: "a.status = 'published'",
  order: "a.published_at DESC",
});
