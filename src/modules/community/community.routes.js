"use strict";
/**
 * Staff Community routes (docs/guides/community.md §5), under /api/v1/community.
 * The module grant is the outer gate; membership of the channel is checked in the
 * service on every channel and message route.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const { linkPreviewLimiter } = require("../../middleware/rate-limit");
const controller = require("./community.controller");

const router = express.Router();
const cm = c.community;
const view = () => requirePermission("community", "view");
const create = () => requirePermission("community", "create");

route(
  router,
  "get",
  "/channels",
  {
    query: cm.ChannelListQuery,
    response: cm.ChannelPage,
    summary: "My channels",
  },
  view(),
  controller.listChannels,
);
route(
  router,
  "post",
  "/channels",
  { body: cm.ChannelCreate, response: cm.Channel, summary: "Create a channel" },
  create(),
  controller.createChannel,
);
route(
  router,
  "get",
  "/channels/:id",
  { response: cm.Channel, summary: "One of my channels" },
  view(),
  controller.getChannel,
);
route(
  router,
  "put",
  "/channels/:id",
  { body: cm.ChannelUpdate, response: cm.Channel, summary: "Rename a channel or change its description" },
  create(),
  controller.updateChannel,
);
route(
  router,
  "get",
  "/channels/:id/members",
  {
    query: cm.MemberListQuery,
    response: cm.MemberPage,
    summary: "A channel's members",
  },
  view(),
  controller.listMembers,
);
route(
  router,
  "post",
  "/channels/:id/members",
  {
    body: cm.MemberAdd,
    response: cm.Channel,
    summary: "Add people to a channel",
  },
  create(),
  controller.addMembers,
);
route(
  router,
  "put",
  "/channels/:id/members/:user_id/role",
  {
    params: cm.MemberParams,
    body: cm.MemberRoleSet,
    response: cm.Member,
    summary: "Make or unmake a channel admin",
  },
  create(),
  controller.setRole,
);
route(
  router,
  "delete",
  "/channels/:id/members/:user_id",
  { no_content: true, summary: "Remove someone from a channel" },
  create(),
  controller.removeMember,
);
route(
  router,
  "put",
  "/channels/:id/pin",
  {
    body: cm.PinSet,
    no_content: true,
    summary: "Pin or unpin a conversation for oneself",
  },
  view(),
  controller.pin,
);
route(
  router,
  "post",
  "/channels/:id/mute",
  {
    body: cm.MuteSet,
    no_content: true,
    summary: "Mute or unmute a conversation",
  },
  view(),
  controller.mute,
);
route(
  router,
  "post",
  "/channels/:id/read",
  {
    body: c.common.EmptyBody,
    no_content: true,
    summary: "Mark a conversation read",
  },
  view(),
  controller.read,
);
route(
  router,
  "post",
  "/channels/:id/delivered",
  {
    body: cm.DeliveredAck,
    no_content: true,
    summary: "Acknowledge direct messages received",
  },
  view(),
  controller.delivered,
);
route(
  router,
  "get",
  "/channels/:id/messages",
  {
    query: cm.MessageListQuery,
    response: cm.MessagePage,
    summary: "A conversation's messages, newest page first",
  },
  view(),
  controller.listMessages,
);
route(
  router,
  "get",
  "/channels/:id/pins",
  {
    query: cm.PinListQuery,
    response: cm.MessagePage,
    summary: "What is pinned at the top of a conversation",
  },
  view(),
  controller.listPins,
);
route(
  router,
  "post",
  "/channels/:id/messages",
  { body: cm.MessageCreate, response: cm.Message, summary: "Post a message" },
  create(),
  controller.postMessage,
);
route(
  router,
  "post",
  "/channels/:id/media",
  {
    body: c.documents.DocumentUpload,
    response: c.documents.MediaRef,
    summary: "Upload a file or voice note to post",
  },
  create(),
  upload.single("file", { purpose: "attachment" }),
  controller.uploadMedia,
);
route(
  router,
  "post",
  "/link-previews",
  {
    body: cm.LinkPreviewRequest,
    response: cm.LinkPreviewAnswer,
    summary: "A link's card for the composer",
  },
  create(),
  linkPreviewLimiter,
  controller.linkPreview,
);
route(
  router,
  "post",
  "/recognitions",
  {
    body: cm.RecognitionCreate,
    response: cm.Message,
    summary: "Recognise a colleague in #general",
  },
  create(),
  controller.recognise,
);
route(
  router,
  "put",
  "/messages/:id",
  { body: cm.MessageEdit, response: cm.Message, summary: "Edit a message" },
  create(),
  controller.editMessage,
);
route(
  router,
  "delete",
  "/messages/:id",
  { no_content: true, summary: "Delete a message" },
  create(),
  controller.deleteMessage,
);
route(
  router,
  "put",
  "/messages/:id/pin",
  { body: cm.MessagePin, response: cm.Message, summary: "Pin a message for a while" },
  view(),
  controller.pinMessage,
);
route(
  router,
  "delete",
  "/messages/:id/pin",
  { response: cm.Message, summary: "Unpin a message" },
  view(),
  controller.unpinMessage,
);
route(
  router,
  "post",
  "/messages/:id/close",
  { body: c.common.EmptyBody, response: cm.Message, summary: "Close a poll" },
  create(),
  controller.closePoll,
);
route(
  router,
  "post",
  "/messages/:id/reactions",
  {
    body: c.common.EmptyBody,
    response: cm.Message,
    summary: "Celebrate or thumb up a message",
  },
  view(),
  controller.react,
);
route(
  router,
  "post",
  "/messages/:id/vote",
  { body: cm.PollVote, response: cm.Message, summary: "Vote in a poll" },
  view(),
  controller.vote,
);
route(
  router,
  "post",
  "/messages/:id/transcript",
  {
    body: c.common.EmptyBody,
    response: cm.Transcript,
    summary: "Transcribe a voice note",
  },
  view(),
  controller.transcript,
);
route(
  router,
  "get",
  "/direct",
  {
    query: cm.ConversationListQuery,
    response: cm.ConversationPage,
    summary: "My direct conversations",
  },
  view(),
  controller.listConversations,
);
route(
  router,
  "post",
  "/direct",
  {
    body: cm.DirectCreate,
    response: cm.Conversation,
    summary: "Open a conversation with a colleague",
  },
  create(),
  controller.openDirect,
);
route(
  router,
  "get",
  "/people",
  {
    query: cm.ColleagueListQuery,
    response: cm.ColleaguePage,
    summary: "Colleagues to message or recognise",
  },
  view(),
  controller.listColleagues,
);
route(
  router,
  "get",
  "/people/:id/card",
  { response: cm.ProfileCard, summary: "A colleague's profile card" },
  view(),
  controller.profileCard,
);

module.exports = { basePath: "/community", surface: "staff", router };
