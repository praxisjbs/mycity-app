/**
 * Staff Community is on the contract (packages/contract/schemas/community.js and
 * announcements.js): channels, direct conversations, messages, recognition, polls,
 * celebrations and announcements are typed by the generated `Endpoints`
 * (api/endpoints.ts). These are the contract's types under the names the screens use.
 */
export type {
  Announcement,
  AnnouncementCreate,
  AnnouncementReader,
  AnnouncementStats,
  Audience,
  Channel,
  ChannelCreate,
  Conversation,
  Member,
  Message,
  MessageCreate,
  MessageStatus,
  MessageType,
  PostPolicy,
  ProfileCard,
} from "@mycity/contract/contract.gen.ts";
