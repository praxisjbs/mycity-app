"use strict";
/**
 * What the assistant may read and do in Staff Community (community.md §9): published
 * announcements, and the caller's own channels by name. Never a message body and never
 * a direct conversation: private conversation is not material for the assistant. As cards the
 * person confirms (docs/guides/praxis-ai.md §6.11; decision 19) it carries a message to a
 * colleague, in the conversation with them, and a post in a channel the person may post in,
 * each sent as the chat box sends it; the words are the person's and the records read, never
 * anything the assistant read in a conversation. Every other form of Staff Community is a card too
 * (decisions 33 and 40): New Channel, Edit Channel, Recognise, Send Wishes and Edit Message, each
 * through the service function the screen's own button calls; a channel is named by its name, a
 * celebration card by whose it is, a message by where it is and never by its words.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const repo = require("./community.repo");
const service = require("./community.service");
const announcements = require("../announcements/announcements.repo");

const threadLink = (channelId) => (routeMap.linkFor("direct_thread", channelId) || {}).path || null;
const channelLink = (channelId) => (routeMap.linkFor("channel", channelId) || {}).path || null;

/** A private group channel of the outsider's alone, made once per asker through Channels' own service. */
async function privateChannelOf(ctx) {
  const name = `matrix-${ctx.role.replace(/_/g, "-")}`.slice(0, 30);
  const had = (await service.listChannels(ctx.outsider.user, {})).data.find((ch) => ch.name === name);
  if (had) return had.community_channel_id;
  const ch = await service.createChannel({ name, description: null, post_policy: "everyone", member_ids: [], department_ids: [] }, ctx.outsider.user);
  return ch.community_channel_id;
}

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17). Membership decides what a person
 * reaches here, whatever their grant's scope: #general, which everyone joins, is listed and may be
 * posted in; a private channel of the outsider's alone is never listed and a card posting in it is
 * refused. A message goes to a colleague on the staff, never to an id that is nobody's.
 */
/** A group channel of the asker's own, made once through Channels' own service: they are its admin. */
async function ownChannelOf(ctx) {
  const name = `mine-${ctx.role.replace(/_/g, "-")}`.slice(0, 30);
  const had = (await service.listChannels(ctx.actor, {})).data.find((ch) => ch.name === name);
  if (had) return had.community_channel_id;
  return (await service.createChannel({ name, description: null, post_policy: "everyone", member_ids: [], department_ids: [] }, ctx.actor)).community_channel_id;
}

/** A birthday card for someone, posted by hand in a channel, as its admin posts one. */
const cardIn = async (channelId, subjectId, who) => (await service.postMessage(channelId, { message_type: "birthday", subject_employee_id: subjectId }, who)).community_message_id;
/** A text message posted in a channel, as its chat box posts it. */
const textIn = async (channelId, who) => (await service.postMessage(channelId, { message_type: "text", body: "A note for the matrix to change" }, who)).community_message_id;

/**
 * The matrix's probes for the cards that change what is there: a channel, a card and a message of the
 * asker's own channel are theirs to change or wish on; the outsider's private channel, which they are
 * not in, never is. A recognition goes to a colleague, never to an id that is nobody's.
 */
const ownProbe = (valuesOf) => ({
  inside: async (ctx) => {
    const id = await ownChannelOf(ctx);
    return { type: "channel", id, values: await valuesOf(id, ctx.actor, ctx.outsider.employee_id) };
  },
  outside: async (ctx) => {
    const id = await privateChannelOf(ctx);
    return { type: "channel", id, values: await valuesOf(id, ctx.outsider.user, ctx.actor.employee_id) };
  },
});
const channelEditProbe = ownProbe((id) => ({ community_channel_id: id, description: "Changed by the matrix" }));
const wishProbe = ownProbe(async (id, who, subject) => ({ community_message_id: await cardIn(id, subject, who), body: "Happy birthday from the matrix" }));
const editProbe = ownProbe(async (id, who) => ({ community_channel_id: id, community_message_id: await textIn(id, who), body: "Changed by the matrix" }));
const recogniseProbe = {
  inside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id, values: { to_employee_id: ctx.outsider.employee_id, message: "Thank you from the matrix" } }),
  outside: () => ({ type: "employee", id: "00000000-0000-4000-8000-0000000000ac", values: { to_employee_id: "00000000-0000-4000-8000-0000000000ac", message: "Thank you from the matrix" } }),
};

/** #general, which every login joins the first time it lists its channels. */
async function generalChannelOf(ctx) {
  const general = (await service.listChannels(ctx.actor, {})).data.find((ch) => ch.name === "general");
  return general ? general.community_channel_id : null;
}
const channelProbe = {
  inside: async (ctx) => {
    const id = await generalChannelOf(ctx);
    return id ? { type: "channel", id, values: { community_channel_id: id, body: "A note from the matrix" } } : null;
  },
  outside: async (ctx) => ({ type: "channel", id: await privateChannelOf(ctx), values: { community_channel_id: await privateChannelOf(ctx), body: "A note from the matrix" } }),
};
const messageProbe = {
  inside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id, values: { employee_id: ctx.outsider.employee_id, body: "A note from the matrix" } }),
  outside: () => ({ type: "employee", id: "00000000-0000-4000-8000-0000000000ab", values: { employee_id: "00000000-0000-4000-8000-0000000000ab", body: "A note from the matrix" } }),
};

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
      // Who and what, asked first when not said (praxis-ai.md decision 34): a colleague by name from the directory.
      asks: [
        { field: "employee_id", question: "Who is it for?", read: "colleagues.list" },
        { field: "body", question: "What should it say?" },
      ],
      records: (values, _actor, db) => (values.employee_id ? (db ? service.colleagueRecords(db, [values.employee_id]) : [{ type: "employee", id: values.employee_id }]) : []),
      check: (client, values) => service.assertColleague(client, values.employee_id),
      run: (values, actor) => service.sendDirect(values.employee_id, values.body, actor),
      readback: (m) => [{ type: "direct_message", id: m.community_message_id, label: "Message sent", status: "sent", link: threadLink(m.community_channel_id) }],
      labels: { employee_id: "To", body: "Message" },
      matrix: messageProbe,
    },
    {
      key: "community.post",
      label: "Post Message",
      description: "Post a message in one of my channels, written from what I said and the records read",
      input: c.community.ChannelPost,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: the chat box is the channel's own and never names its channel; the card must",
      // Which channel and what, asked first when not said (decision 34): the person's own channels to tap.
      asks: [
        { field: "community_channel_id", question: "Which channel?", read: "channels.list" },
        { field: "body", question: "What should it say?" },
      ],
      records: (values, actor, db) => (values.community_channel_id ? (db ? service.channelRecords(db, [values.community_channel_id], actor) : [{ type: "channel", id: values.community_channel_id }]) : []),
      check: (client, values, actor) => service.assertMayPost(client, values.community_channel_id, actor),
      run: (values, actor) => service.postMessage(values.community_channel_id, { message_type: "text", body: values.body }, actor),
      readback: (m) => [{ type: "channel_message", id: m.community_message_id, label: "Posted", status: "posted", link: channelLink(m.community_channel_id) }],
      labels: { community_channel_id: "Channel", body: "Message" },
      matrix: channelProbe,
    },
    {
      key: "channels.create",
      label: "Create Channel",
      description: "Create a channel I will run: its name (lower case, numbers and hyphens), its purpose, who can post, and the people or departments in it",
      input: c.community.ChannelCreate,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: New Channel's form keeps its purpose, people and departments in fields of its own and posts the purpose after; the card carries the channel",
      picks: { member_ids: "colleague", department_ids: "department" },
      asks: [{ field: "name", question: "What is the channel called?" }],
      names: (values, _actor, db) => service.cardNames(db, { employees: values.member_ids, departments: values.department_ids }),
      // The same functions New Channel calls: the channel, then its purpose posted in it.
      run: (values, actor) => service.createChannelFromCard(values, actor),
      readback: (ch) => [{ type: "channel", id: ch.community_channel_id, label: `#${ch.name}`, status: "created", link: channelLink(ch.community_channel_id) }],
      labels: { name: "Channel Name", description: "Purpose", post_policy: "Who Can Post", member_ids: "People", department_ids: "Departments" },
    },
    {
      key: "channels.edit",
      label: "Save Channel",
      matrix: channelEditProbe,
      description: "Rename a channel I am an admin of, or change its purpose: the channel by its name; only what changes",
      input: c.community.ChannelChange,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: Edit Channel is opened on its channel and never names it; the card names the channel",
      // Which channel, when the person did not say (praxis-ai.md decision 34): the channels they run, to tap.
      asks: [{ field: "community_channel_id", question: "Which channel?", options: ({ actor, db }) => service.adminChannelChoices(db, actor) }],
      resolve: { community_channel_id: (value, actor, db) => service.channelIdOf(db, value, actor) },
      records: (values, actor, db) => (db ? service.cardChannel(db, values.community_channel_id, actor) : []),
      // Its admin alone, never #general or #announcements: the service's own rule.
      check: async (client, values, actor) => {
        await service.assertAdmin(client, values.community_channel_id, actor);
      },
      run: (values, actor) => service.changeChannel(values, actor),
      readback: (ch) => [{ type: "channel", id: ch.community_channel_id, label: `#${ch.name}`, status: "saved", link: channelLink(ch.community_channel_id) }],
      labels: { community_channel_id: "Channel", name: "Channel Name", description: "Purpose" },
    },
    {
      key: "community.recognise",
      label: "Post Recognition",
      matrix: recogniseProbe,
      description: "Recognise a colleague in #general, with a note written from what I said, or a thank you note when I give none",
      input: c.community.RecognitionCreate,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: Recognise's form is its own colleague picker and note; the card carries the same two fields",
      picks: { to_employee_id: "colleague" },
      // Whom, when the person did not say (decision 34): a colleague by name from the directory.
      asks: [{ field: "to_employee_id", question: "Who are you recognising?", read: "colleagues.list" }],
      names: (values, _actor, db) => service.cardNames(db, { employees: [values.to_employee_id] }),
      check: (client, values) => service.assertColleague(client, values.to_employee_id),
      run: (values, actor) => service.recognise(values, actor),
      readback: (m) => [{ type: "channel_message", id: m.community_message_id, label: "Posted to #general", status: "posted", link: channelLink(m.community_channel_id) }],
      labels: { to_employee_id: "Colleague", message: "Note" },
    },
    {
      key: "community.wish",
      label: "Send Wishes",
      matrix: wishProbe,
      description: "Send wishes on a colleague's birthday or work anniversary card of the last two weeks, named by whose it is, in the person's words: wish her a happy birthday is Happy birthday!",
      input: c.community.WishSend,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: Send Wishes is opened on its card and never names it; the card names whose birthday or anniversary it is",
      // Whose card and the wish, asked first when not said (decision 34): the cards of the last two weeks to tap.
      asks: [
        { field: "community_message_id", question: "Whose card is it?", options: ({ actor, db }) => service.celebrationChoices(db, actor) },
        { field: "body", question: "What is your wish?" },
      ],
      resolve: { community_message_id: (value, actor, db) => service.celebrationIdOf(db, value, actor) },
      records: (values, actor, db) => (db ? service.cardCelebration(db, values.community_message_id, actor) : []),
      check: (client, values, actor) => service.assertCardCelebration(client, values.community_message_id, actor),
      run: (values, actor) => service.sendWish(values.community_message_id, { body: values.body }, actor),
      readback: (m) => [{ type: "channel_message", id: m.community_message_id, label: "Wishes sent", status: "sent", link: channelLink(m.community_channel_id) }],
      labels: { community_message_id: "Card", body: "Wish" },
    },
    {
      key: "community.edit_message",
      label: "Save Message",
      matrix: editProbe,
      description: "Change my newest message in a channel or conversation (named by the channel or the colleague): its words within 15 minutes, or a poll's question and options before its first vote",
      input: c.community.MessageChange,
      permission: ["community", "create"],
      risk: "standard",
      form: "none: Edit Message is opened on its message and never names it; the card names where it is, never its words",
      fields: ["community_channel_id", "community_message_id", "body", "options"],
      // Where, which and the new words, asked first when not said (decision 34): the person's own
      // channels to tap (a conversation with a colleague is typed by their name), then their newest
      // message or poll there, never one picked by its words.
      asks: [
        { field: "community_channel_id", question: "Where is the message?", read: "channels.list" },
        { field: "community_message_id", question: "Which message?", choices: ["My Newest Message", "My Newest Poll"] },
        { field: "body", question: "What should it say now?" },
      ],
      resolve: {
        community_channel_id: (value, actor, db) => service.channelIdOf(db, value, actor, { direct: true }),
        community_message_id: (value, actor, db, values) => service.messageIdOf(db, values.community_channel_id, value, actor),
      },
      names: (values, actor, db) => service.cardChannel(db, values.community_channel_id, actor),
      records: (values, actor, db) => (db ? service.cardMessage(db, values, actor) : []),
      check: (client, values, actor) => service.assertCardMessage(client, values, actor),
      run: (values, actor) => service.editMessage(values.community_message_id, { body: values.body, ...(values.options ? { options: values.options } : {}) }, actor),
      readback: (m) => [{ type: "channel_message", id: m.community_message_id, label: "Message changed", status: "saved", link: channelLink(m.community_channel_id) }],
      labels: { community_channel_id: "Conversation", community_message_id: "Message", body: "Message Words", options: "Options" },
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    ChannelUpdate: "via channels.edit: Edit Channel's own form, which never names its channel; the card is ChannelChange",
    WishCreate: "via community.wish: Send Wishes' own form, which never names its card; the card is WishSend",
    MessageEdit: "via community.edit_message: Edit Message's own form, which never names its message; the card is MessageChange",
    MessageCreate: "via community.message: the chat box's own shape, a file or a poll included; the cards carry words alone (DirectMessageSend, ChannelPost)",
    DirectCreate: "via community.message: opening a conversation is the first message's own step",
  },
  reads: [
    {
      // Staff Community's own directory: anyone with a login, as New Message and New Event list them,
      // so a task's watcher, a meeting's guest or a message's colleague is found by name for anyone
      // (docs/guides/praxis-ai.md §6.9). The caller is listed too, so every reader sees the same people.
      key: "colleagues.list",
      summary: "none: a directory search; headcount is employees.summary",
      description: "Find colleagues by name: everyone with a login, with their job title and department",
      params: c.community.ColleagueListQuery,
      permission: ["community", "view"],
      run: async (client, params, actor) => {
        const page = await repo.listColleagues(client, { ...params, with_self: true }, actor.user_id);
        return {
          ...page,
          data: page.data.map(({ person: p }) => ({ employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department })),
        };
      },
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
    },
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
      summary: "none: a short list; messages are never read (decision 19)",
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
      matrix: channelProbe,
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
