"use strict";
/**
 * What the assistant may do about announcements (docs/guides/community.md §9): publish one, now or
 * at a time, and change one still waiting to go out, as cards the person confirms with one press,
 * as the screen's own button publishes (docs/guides/praxis-ai.md §6.11, decision 40), each through
 * the service function New Announcement and Edit Announcement call, held to `announcements.post`
 * as their routes are. Its read, the published announcements, is community.ai.js's, beside the
 * channels.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const community = require("../community/community.service");
const service = require("./announcements.service");

/** The announcement a card published, scheduled or changed, read back as a line that opens it. */
const announcementLine = (status) => (a) => [
  { type: "announcement", id: a.announcement_id, label: a.title, status: status || (a.status === "scheduled" ? "scheduled" : "published"), link: (routeMap.linkFor("announcement", a.announcement_id) || {}).path || null },
];
const LABELS = { title: "Headline", body: "Message", audience: "Audience", department_ids: "Departments", urgency: "Level", publish_at: "Goes Out" };
/** Which departments, asked only for an announcement to chosen departments (praxis-ai.md decision 34): the departments to tap, matched by name. */
const departmentsAsked = { field: "department_ids", question: "Which departments?", when: { field: "audience", not: ["all_staff"] }, read: "departments.list" };

module.exports = defineManifest({
  module: "community",
  actions: [
    {
      key: "announcements.publish",
      label: "Publish Announcement",
      description: "Publish an announcement to all staff (audience all_staff) or chosen departments, at once or at a time ahead: the headline, the message and its level",
      input: c.announcements.AnnouncementPost,
      permission: ["community", "create"],
      // As the route: POST /community/announcements asks requireCapability("announcements.post").
      capability: "announcements.post",
      risk: "standard",
      form: "none: New Announcement's form takes a day and a time and keeps its audience as one field; the card says All Staff or Departments",
      picks: { department_ids: "department" },
      asks: [
        { field: "title", question: "What is the headline?" },
        { field: "body", question: "What should it say?" },
        departmentsAsked,
      ],
      names: (values, _actor, db) => community.cardNames(db, { departments: values.department_ids }),
      // The same function Publish Announcement and Schedule Announcement call.
      run: (values, actor) => service.publishFromCard(values, actor),
      readback: announcementLine(null),
      labels: LABELS,
    },
    {
      key: "announcements.edit",
      label: "Save Announcement",
      description: "Change an announcement still waiting to go out (by its headline): its headline, message, audience, level or time; only what changes",
      input: c.announcements.AnnouncementChange,
      permission: ["community", "create"],
      capability: "announcements.post",
      risk: "standard",
      form: "none: Edit Announcement is opened on its announcement and never names it; the card names the announcement",
      picks: { department_ids: "department" },
      // Which announcement, when the person did not say (praxis-ai.md decision 34): those still waiting, to tap.
      asks: [{ field: "announcement_id", question: "Which announcement?", options: ({ db }) => service.scheduledChoices(db) }, departmentsAsked],
      resolve: { announcement_id: (value, _actor, db) => service.idOf(db, value) },
      names: (values, _actor, db) => community.cardNames(db, { departments: values.department_ids }),
      records: (values, _actor, db) => (db ? service.cardRecords(db, values.announcement_id) : []),
      check: (client, values) => service.assertScheduled(client, values.announcement_id),
      run: (values, actor) => service.changeFromCard(values, actor),
      readback: announcementLine("saved"),
      labels: { announcement_id: "Announcement", ...LABELS },
    },
  ],
  // New Announcement's and Edit Announcement's own forms, reached through the cards (gate 23, praxis-ai.md decision 33).
  not_offered: {
    AnnouncementCreate: "via announcements.publish: New Announcement's own form, its audience one field of the form's own; the card is AnnouncementPost",
    AnnouncementUpdate: "via announcements.edit: Edit Announcement's own form, which never names its announcement; the card is AnnouncementChange",
  },
});
