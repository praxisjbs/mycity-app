"use strict";
/**
 * Staff Community (M1, docs/guides/community.md §5): channels, direct messages, the
 * messages in them, recognition (A19) and celebrations (A20).
 *
 * A direct conversation is a community_channel of channel_type "direct" with its two
 * members, so one message table, one read pointer and one paging rule serve both.
 * Membership is the authorisation boundary for every read and write.
 *
 * Announcements, the tracking side, are in announcements.js; a published one is also a
 * message of message_type "announcement" in #announcements.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");
const { NotificationUrgency } = require("./notifications");

/** Who may post in a channel, fixed when it is created (§6). */
const POST_POLICIES = ["everyone", "admins", "people_ceo"];
const PostPolicy = z.enum(POST_POLICIES);

/** What a channel is. "direct" is a one to one conversation. */
const CHANNEL_TYPES = ["company", "department", "team", "group", "direct"];
const ChannelType = z.enum(CHANNEL_TYPES);

/**
 * What a message is. "audio" is a voice note; "birthday" and "anniversary" are
 * celebration cards (A20); "announcement" is a published announcement in #announcements.
 */
const MESSAGE_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "file",
  "system",
  "poll",
  "recognition",
  "birthday",
  "anniversary",
  "announcement",
];
const MessageType = z.enum(MESSAGE_TYPES);

/** Delivery ticks on a direct message the caller sent (§3 step 10). */
const MessageStatus = z.enum(["sent", "delivered", "read"]);

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

/** A channel as the list and the thread header show it, for the caller. */
const Channel = z
  .object({
    community_channel_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    channel_type: ChannelType,
    post_policy: PostPolicy,
    pinned: z.boolean(),
    pin_locked: z.boolean(),
    members: z.number().int().min(0),
    can_post: z.boolean(),
    is_admin: z.boolean(),
    can_moderate: z.boolean(),
    can_poll: z.boolean(),
    muted: z.boolean(),
    unread: z.number().int().min(0),
    last_text: z.string().nullable(),
    last_at: isoDateTime.nullable(),
  })
  .strict();

/** GET /community/channels: the caller's channels, pinned first, then latest activity. */
const ChannelListQuery = listQuery();
const ChannelPage = Paged(Channel);

/** The channel name rule (§6): 2 to 30 lower case letters, numbers and hyphens. */
const ChannelName = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,29}$/, "Not a valid name");

/** POST /community/channels. The creator is its admin and a member. */
const ChannelCreate = z
  .object({
    name: ChannelName,
    description: optionalText(300),
    post_policy: z.enum(["everyone", "admins"]).default("everyone"),
    member_ids: z.array(uuid).max(500).default([]),
    department_ids: z.array(uuid).max(50).default([]),
  })
  .strict();

/** A member of a channel. */
const Member = z
  .object({
    person: PersonRef,
    user_id: uuid,
    member_role: z.enum(["admin", "member"]),
    joined_at: isoDateTime,
  })
  .strict();
const MemberListQuery = listQuery();
const MemberPage = Paged(Member);

/** POST /community/channels/:id/members: add people, or whole departments. */
const MemberAdd = z
  .object({
    member_ids: z.array(uuid).max(500).default([]),
    department_ids: z.array(uuid).max(50).default([]),
  })
  .strict()
  .refine((b) => b.member_ids.length + b.department_ids.length > 0, {
    message: "Add someone",
    path: ["member_ids"],
  });
const MemberParams = z.object({ id: uuid, user_id: uuid }).strict();

/** PUT /community/channels/:id/members/:user_id/role: make or unmake an admin. */
const MemberRoleSet = z.object({ member_role: z.enum(["admin", "member"]) }).strict();

/** POST /community/channels/:id/mute: on or off. */
const MuteSet = z.object({ muted: z.boolean() }).strict();

/** PUT /community/channels/:id/pin: the caller's own pin, at most 3 (§3 step 16). */
const PinSet = z.object({ pinned: z.boolean() }).strict();

/** POST /community/channels/:id/delivered: the client has received up to this instant. */
const DeliveredAck = z.object({ up_to: isoDateTime }).strict();

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

const PollOption = z.object({ text: z.string(), votes: z.number().int().min(0) }).strict();

/** One message, for the caller. The block that matches message_type is set; the rest are null. */
const Message = z
  .object({
    community_message_id: uuid,
    community_channel_id: uuid,
    message_type: MessageType,
    author: PersonRef.nullable(),
    mine: z.boolean(),
    sent_at: isoDateTime,
    body: z.string().nullable(),
    document: DocumentRef.nullable(),
    duration_s: z.number().int().min(0).nullable(),
    transcript: z.string().nullable(),
    celebration: z
      .object({
        subject: PersonRef,
        years: z.number().int().min(1).nullable(),
        count: z.number().int().min(0),
        mine: z.boolean(),
        fans: z.array(PersonRef).max(3),
      })
      .strict()
      .nullable(),
    recognition: z
      .object({ to: PersonRef, count: z.number().int().min(0), mine: z.boolean() })
      .strict()
      .nullable(),
    poll: z
      .object({
        question: z.string(),
        options: z.array(PollOption).min(2).max(4),
        my_vote: z.number().int().min(0).max(3).nullable(),
        closed: z.boolean(),
      })
      .strict()
      .nullable(),
    /**
     * The announcement this message publishes. An urgent one waits on the caller's Acknowledge when
     * they are in its audience (`in_audience`) and `acknowledged_at` is still null.
     */
    announcement: z
      .object({
        announcement_id: uuid,
        title: z.string(),
        urgency: NotificationUrgency,
        in_audience: z.boolean(),
        acknowledged_at: isoDateTime.nullable(),
      })
      .strict()
      .nullable(),
    status: MessageStatus.nullable(),
    deleted: z.boolean(),
    edited_at: isoDateTime.nullable(),
    can_edit: z.boolean(),
    can_delete: z.boolean(),
    can_close: z.boolean(),
  })
  .strict();

/**
 * GET /community/channels/:id/messages: newest page first. With `q`, only the messages
 * of this conversation that match, newest first (§3 step 9).
 */
const MessageListQuery = listQuery();
const MessagePage = Paged(Message);

/**
 * POST /community/channels/:id/messages.
 *   text            body
 *   image, audio, video, file   document_id (uploaded first), body optional as a caption;
 *                   audio carries duration_s
 *   poll            body is the question, options 2 to 4
 *   birthday, anniversary   subject_employee_id: a celebration card posted by hand
 */
const MessageCreate = z
  .object({
    message_type: z.enum(["text", "image", "audio", "video", "file", "poll", "birthday", "anniversary"]),
    body: optionalText(4000),
    document_id: uuid.optional(),
    duration_s: z.number().int().min(1).max(300).optional(),
    options: z.array(text(80)).min(2).max(4).optional(),
    subject_employee_id: uuid.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const need = (key, msg) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: msg });
    if ((b.message_type === "text" || b.message_type === "poll") && !b.body) need("body", "Write something");
    if (["image", "audio", "video", "file"].includes(b.message_type) && !b.document_id) need("document_id", "Attach a file");
    if (b.message_type === "audio" && !b.duration_s) need("duration_s", "Give its length");
    if (b.message_type === "poll" && !b.options) need("options", "Add an option");
    if ((b.message_type === "birthday" || b.message_type === "anniversary") && !b.subject_employee_id)
      need("subject_employee_id", "Choose a colleague");
  });

/** POST /community/recognitions: always posted to #general (A19). */
const RecognitionCreate = z
  .object({
    to_employee_id: uuid,
    message: optionalText(500),
  })
  .strict();

/** POST /community/messages/:id/vote. */
/**
 * PUT /community/messages/:id: the author's text within 15 minutes, or their poll's
 * question (body) and options before its first vote (community.md §3 step 14).
 */
const MessageEdit = z
  .object({
    body: text(4000),
    options: z.array(text(80)).min(2).max(4).optional(),
  })
  .strict();

const PollVote = z.object({ option_index: z.number().int().min(0).max(3) }).strict();

/** POST /community/messages/:id/transcript. */
const Transcript = z.object({ transcript: z.string() }).strict();

/* ------------------------------------------------------------------ *
 * Direct messages
 * ------------------------------------------------------------------ */

/** One conversation in the caller's list. */
const Conversation = z
  .object({
    community_channel_id: uuid,
    person: PersonRef,
    user_id: uuid,
    is_self: z.boolean(),
    online: z.boolean(),
    last_seen_at: isoDateTime.nullable(),
    pinned: z.boolean(),
    muted: z.boolean(),
    unread: z.number().int().min(0),
    last_text: z.string().nullable(),
    last_mine: z.boolean(),
    last_at: isoDateTime.nullable(),
  })
  .strict();
const ConversationListQuery = listQuery({ unread: z.coerce.boolean().optional() });
const ConversationPage = Paged(Conversation);

/** POST /community/direct: open (or find) the conversation with one colleague. */
const DirectCreate = z.object({ employee_id: uuid }).strict();

/**
 * GET /community/people: colleagues to message or recognise, for every member of staff.
 * Public work fields only (the people picker); the staff register itself needs People.
 */
/** with_self: New Message offers the caller too (a conversation with oneself); every other picker leaves them out. */
const ColleagueListQuery = listQuery({ with_self: z.coerce.boolean().optional() });
const ColleaguePage = Paged(PersonRef);

/** GET /community/people/:id/card: the profile panel (§3 step 8). */
const ProfileCard = z
  .object({
    person: PersonRef,
    user_id: uuid.nullable(),
    work_email: z.string().nullable(),
    phone: z.string().nullable(),
    worksite: z.string().nullable(),
    online: z.boolean(),
    last_seen_at: isoDateTime.nullable(),
    shared_files: z.array(DocumentRef).max(25),
    voice_notes: z.number().int().min(0),
    shared_channels: z.array(z.string()).max(25),
  })
  .strict();

/** Gate 6 (check/contract-columns.js). */
const TABLES = {
  Channel: {
    table: "community_channel",
    virtual: {
      members: "how many members, counted from community_member",
      can_post: "whether the caller may post, from post_policy, their role and the announcements.post capability",
      is_admin: "whether the caller is an admin of the channel, from community_member.member_role",
      pin_locked: "pinned for everyone (#general, #announcements), from community_channel.pinned; pinned is that or the caller's own pin",
      can_moderate: "whether the caller moderates it: an admin, or People and the CEO in #general and #announcements",
      can_poll: "whether the caller may start a poll: as can_post, and in #general moderators only",
      muted: "whether the caller muted it, from community_member.muted_until",
      unread: "messages after the caller's community_member.last_read_at, counted",
      last_text: "the latest message, as one line",
      last_at: "when the latest message was sent",
    },
  },
  ChannelListQuery: { table: null, reason: "list controls for the caller's channels" },
  ChannelPage: { table: null, reason: "a page of channels" },
  ChannelCreate: {
    table: "community_channel",
    virtual: {
      member_ids: "the users added as members, written to community_member",
      department_ids: "departments whose people are added as members, written to community_member",
    },
  },
  Member: {
    table: "community_member",
    virtual: { person: "the member's employee, as a PersonRef with their photo_url" },
  },
  MemberListQuery: { table: null, reason: "list controls for a channel's members" },
  MemberPage: { table: null, reason: "a page of members" },
  MemberAdd: {
    table: null,
    reason: "who to add: users and departments, each becoming a community_member row",
  },
  MemberParams: { table: null, reason: "the channel and the member's user in the path" },
  MemberRoleSet: { table: "community_member" },
  MuteSet: { table: null, reason: "sets community_member.muted_until for the caller" },
  PinSet: { table: null, reason: "sets community_member.pinned_at for the caller" },
  DeliveredAck: { table: null, reason: "moves the caller's community_member.last_delivered_at" },
  PollOption: { table: null, reason: "one option of a poll, its text from metadata and its votes counted" },
  Message: {
    table: "community_message",
    virtual: {
      author: "the sender's employee, as a PersonRef with their photo_url; null for a system post",
      mine: "whether the caller sent it",
      document: "the attached file, from document",
      duration_s: "a voice note's length, from metadata",
      celebration: "a birthday or anniversary card: its person (a PersonRef with photo_url) from metadata, reactions counted",
      recognition: "a recognition card: who it recognises (a PersonRef with photo_url) from peer_recognition, reactions counted",
      poll: "a poll's options from metadata and the votes in community_poll_vote",
      announcement: "the announcement this message publishes, from announcement",
      status: "a direct message's ticks, from the other member's read and delivered pointers",
      deleted: "whether it was deleted, from deleted_at",
      can_edit: "whether the caller may edit it now: the author, text within 15 minutes or a poll before its first vote",
      can_delete: "whether the caller may delete it: the author or a moderator, never an announcement's post",
      can_close: "whether the caller may close it: an open poll, by its author or a moderator",
    },
  },
  MessageListQuery: { table: null, reason: "list controls for a conversation's messages" },
  MessageEdit: {
    table: "community_message",
    virtual: { options: "a poll's options, kept in metadata" },
  },
  MessagePage: { table: null, reason: "a page of messages" },
  MessageCreate: {
    table: "community_message",
    virtual: {
      duration_s: "a voice note's length, kept in metadata",
      options: "a poll's options, kept in metadata",
      subject_employee_id: "the person a celebration card is for, kept in metadata",
    },
  },
  RecognitionCreate: { table: "peer_recognition" },
  PollVote: { table: "community_poll_vote" },
  Transcript: { table: "community_message" },
  Conversation: {
    table: null,
    reason: "a direct community_channel as the caller's list shows it: the other person (with photo_url) and the latest message",
  },
  ConversationListQuery: { table: null, reason: "list controls and the unread filter for direct messages" },
  ConversationPage: { table: null, reason: "a page of conversations" },
  DirectCreate: { table: null, reason: "the colleague to talk to; becomes a direct community_channel and two members" },
  ColleagueListQuery: { table: null, reason: "list controls for the colleague picker, and whether to offer the caller" },
  ColleaguePage: { table: null, reason: "a page of colleagues, each a PersonRef with their photo_url" },
  ProfileCard: {
    table: null,
    reason: "a colleague's public work details and photo_url from employee, with what this conversation shares",
  },
};

module.exports = {
  TABLES,
  POST_POLICIES,
  CHANNEL_TYPES,
  MESSAGE_TYPES,
  PostPolicy,
  ChannelType,
  MessageType,
  MessageStatus,
  Channel,
  ChannelListQuery,
  ChannelPage,
  ChannelName,
  ChannelCreate,
  Member,
  MemberListQuery,
  MemberPage,
  MemberAdd,
  MemberParams,
  MemberRoleSet,
  MuteSet,
  PinSet,
  DeliveredAck,
  PollOption,
  Message,
  MessageListQuery,
  MessagePage,
  MessageCreate,
  RecognitionCreate,
  MessageEdit,
  PollVote,
  Transcript,
  Conversation,
  ConversationListQuery,
  ConversationPage,
  DirectCreate,
  ColleagueListQuery,
  ColleaguePage,
  ProfileCard,
};
