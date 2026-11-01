"use strict";
/**
 * What the assistant may read and do in Staff Community (community.md §9): published
 * announcements, and the caller's own channels by name. Never a message body and never
 * a direct conversation: private conversation is not material for the assistant. As cards the
 * person confirms (docs/guides/praxis-ai.md §6.11; decision 19) it carries a message to a
 * colleague, in the conversation with them, and a post in a channel the person may post in,
 * each sent as the chat box sends it; the words are the person's and the records read, never
 * anything the assistant read in a conversation.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const repo = require("./community.repo");
const service = require("./community.service");
const announcements = require("../announcements/announcements.repo");

const threadLink = (channelId) => (routeMap.linkFor("direct_thread", channelId) || {}).path || null;
const channelLink = (channelId) => (routeMap.linkFor("channel", channelId) || {}).path || null;

module.exports = defineManifest({
  module: "community",
  actions: [
    {
      key: "community.message",
      label: "Send Message",
      description: "Send a direct message to a colleague, written from what I said and the records read",
      input: c.community.DirectMessageSend,
      permission: ["community", "create"],
      risk: "standard",
      suggest: true,
      // The chat box is the conversation's own; the card names the colleague and carries the words.
      form: "none: the chat box is the conversation's own and never names its colleague; the card must",
      records: (values, _actor, db) => (values.employee_id ? (db ? service.colleagueRecords(db, [values.employee_id]) : [{ type: "employee", id: values.employee_id }]) : []),
      check: (client, values) => service.assertColleague(client, values.employee_id),
      run: (values, actor) => service.sendDirect(values.employee_id, values.body, actor),
      readback: (m) => [{ type: "direct_message", id: m.community_message_id, label: "Message sent", status: "sent", link: threadLink(m.community_channel_id) }],
      labels: { employee_id: "To", body: "Message" },
    },
    {
      key: "community.post",
      label: "Post Message",
      description: "Post a message in one of my channels, written from what I said and the records read",
      input: c.community.ChannelPost,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: the chat box is the channel's own and never names its channel; the card must",
      records: (values, actor, db) => (values.community_channel_id ? (db ? service.channelRecords(db, [values.community_channel_id], actor) : [{ type: "channel", id: values.community_channel_id }]) : []),
      check: (client, values, actor) => service.assertMayPost(client, values.community_channel_id, actor),
      run: (values, actor) => service.postMessage(values.community_channel_id, { message_type: "text", body: values.body }, actor),
      readback: (m) => [{ type: "channel_message", id: m.community_message_id, label: "Posted", status: "posted", link: channelLink(m.community_channel_id) }],
      labels: { community_channel_id: "Channel", body: "Message" },
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    ChannelCreate: "a channel is made on Channels with its members and who may post, in view",
    WishCreate: "a wish is written on a celebration's own card",
    MessageCreate: "the chat box's own shape, a file or a poll included; the cards carry words alone (DirectMessageSend, ChannelPost)",
    RecognitionCreate: "a recognition is given on Channels with the colleague's card in view",
    DirectCreate: "opening a conversation is the first message's own step (community.message)",
  },
  reads: [
    {
      key: "announcements.list",
      description:
        "Published company announcements, newest first, with how many have read each",
      params: c.announcements.AnnouncementListQuery,
      permission: ["community", "view"],
      run: async (client, params) => {
        const page = await announcements.list(client, params);
        return {
          ...page,
          data: page.data
            .filter((a) => a.status === "published")
            .map((a) => ({
              announcement_id: a.announcement_id,
              title: a.title,
              body: a.body,
              published_at: a.published_at,
            })),
        };
      },
      cite: (row) => ({
        type: "announcement",
        id: row.announcement_id,
        label: row.title,
      }),
    },
    {
      key: "channels.list",
      description:
        "The channels the person is a member of, by name, with unread counts",
      params: c.community.ChannelListQuery,
      permission: ["community", "view"],
      run: async (client, params, actor) => {
        const page = await repo.listChannels(client, actor.user_id, params);
        return {
          ...page,
          data: page.data.map((r) => ({
            community_channel_id: r.community_channel_id,
            name: r.name,
            members: r.members,
            unread: r.unread,
          })),
        };
      },
      cite: (row) => ({
        type: "channel",
        id: row.community_channel_id,
        label: `#${row.name}`,
      }),
    },
  ],
  routes: [
    {
      intent: "post an announcement",
      screen: "community.announcements",
      params: { new: "1" },
    },
    {
      intent: "message someone",
      screen: "community.direct-messages",
      params: { new: "1" },
    },
    { intent: "recognise a colleague", screen: "community.channels" },
  ],
});
