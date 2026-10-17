"use strict";
/**
 * What the assistant may read in Staff Community (community.md §9): published
 * announcements, and the caller's own channels by name. Never a message body and never
 * a direct conversation: private conversation is not material for the assistant. It
 * posts nothing (A23); it sends the person to the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const repo = require("./community.repo");
const announcements = require("../announcements/announcements.repo");

module.exports = defineManifest({
  module: "community",
  reads: [
    {
      key: "announcements.list",
      description: "Published company announcements, newest first, with how many have read each",
      params: c.announcements.AnnouncementListQuery,
      permission: ["community", "view"],
      run: async (client, params) => {
        const page = await announcements.list(client, params);
        return { ...page, data: page.data.filter((a) => a.status === "published").map((a) => ({ announcement_id: a.announcement_id, title: a.title, body: a.body, published_at: a.published_at })) };
      },
      cite: (row) => ({ type: "announcement", id: row.announcement_id, label: row.title }),
    },
    {
      key: "channels.list",
      description: "The channels the person is a member of, by name, with unread counts",
      params: c.community.ChannelListQuery,
      permission: ["community", "view"],
      run: async (client, params, actor) => {
        const page = await repo.listChannels(client, actor.user_id, params);
        return { ...page, data: page.data.map((r) => ({ community_channel_id: r.community_channel_id, name: r.name, members: r.members, unread: r.unread })) };
      },
      cite: (row) => ({ type: "channel", id: row.community_channel_id, label: `#${row.name}` }),
    },
  ],
  routes: [
    { intent: "post an announcement", screen: "community.announcements", params: { new: "1" } },
    { intent: "message someone", screen: "community.direct-messages", params: { new: "1" } },
    { intent: "recognise a colleague", screen: "community.channels" },
  ],
});
