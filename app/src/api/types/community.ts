import type { DocumentRef, IsoDateTime, Paged, PersonRef, Uuid } from "./common";

/** INTERIM Staff Community shapes (owner GE; docs/guides/community.md §5). */
export interface Channel {
  channel_id: Uuid;
  name: string;
  members: number;
  read_only: boolean;
  can_post: boolean;
  pinned: boolean;
  unread: number;
  last_text: string | null;
  last_at: IsoDateTime | null;
}
export interface Conversation {
  conversation_id: Uuid;
  person: PersonRef;
  online: boolean;
  unread: number;
  last_text: string | null;
  last_mine: boolean;
  last_at: IsoDateTime | null;
}
export type MessageKind = "text" | "voice" | "file" | "birthday" | "anniversary" | "recognition" | "poll" | "announcement";
export interface Message {
  message_id: Uuid;
  kind: MessageKind;
  author: PersonRef;
  mine: boolean;
  created_at: IsoDateTime;
  text: string | null;
  voice: { duration_s: number; transcript: string | null } | null;
  file: DocumentRef | null;
  celebration: { subject: PersonRef; years: number | null; count: number; mine: boolean; fans: PersonRef[]; wish: string } | null;
  recognition: { to: PersonRef; count: number; mine: boolean } | null;
  poll: { question: string; options: Array<{ text: string; votes: number }>; my_vote: number | null } | null;
  announcement: { title: string; body: string } | null;
  /** Your own direct messages: the delivery ticks. */
  status: "sent" | "delivered" | "read" | null;
}
export interface MessageCreate {
  kind: "text" | "voice" | "file" | "poll" | "birthday" | "anniversary";
  text?: string;
  document_id?: Uuid;
  duration_s?: number;
  poll?: { question: string; options: string[] };
  subject_id?: Uuid;
}
export interface ProfileCard {
  person: PersonRef;
  email: string;
  phone: string | null;
  location: string;
  local_time: string;
  online: boolean;
  manager: PersonRef | null;
  shared_channels: string[];
  shared_files: DocumentRef[];
}
export interface Announcement {
  announcement_id: Uuid;
  title: string;
  body: string;
  author: PersonRef;
  publish_at: IsoDateTime;
  scheduled: boolean;
  reads: number;
  audience: number;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/community/channels": { query: Q; body: never; params: never; response: Paged<Channel> };
    "POST /api/v1/community/channels": { query: never; body: { name: string; member_ids: Uuid[]; departments: string[]; post_policy: "everyone" | "admins" }; params: never; response: Channel };
    "GET /api/v1/community/channels/:id/members": { query: Q; body: never; params: { id: string }; response: Paged<PersonRef> };
    "POST /api/v1/community/channels/:id/read": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "POST /api/v1/community/channels/:id/mute": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "GET /api/v1/community/channels/:id/messages": { query: Q; body: never; params: { id: string }; response: Paged<Message> };
    "POST /api/v1/community/channels/:id/messages": { query: never; body: MessageCreate; params: { id: string }; response: Message };
    "POST /api/v1/community/channels/:id/recognitions": { query: never; body: { to_employee_id: Uuid; text: string }; params: { id: string }; response: Message };
    "POST /api/v1/community/messages/:id/reactions": { query: never; body: Record<string, never>; params: { id: string }; response: Message };
    "POST /api/v1/community/messages/:id/vote": { query: never; body: { option: number }; params: { id: string }; response: Message };
    "POST /api/v1/community/messages/:id/transcript": { query: never; body: Record<string, never>; params: { id: string }; response: { transcript: string } };
    "GET /api/v1/community/direct": { query: Q<{ unread?: boolean }>; body: never; params: never; response: Paged<Conversation> };
    "POST /api/v1/community/direct": { query: never; body: { user_id: Uuid }; params: never; response: Conversation };
    "GET /api/v1/community/direct/:id/messages": { query: Q; body: never; params: { id: string }; response: Paged<Message> };
    "POST /api/v1/community/direct/:id/messages": { query: never; body: MessageCreate; params: { id: string }; response: Message };
    "GET /api/v1/community/people/:user_id/card": { query: never; body: never; params: { user_id: string }; response: ProfileCard };
    "GET /api/v1/community/announcements": { query: Q; body: never; params: never; response: Paged<Announcement> };
    "POST /api/v1/community/announcements": { query: never; body: { title: string; body: string; publish_at?: IsoDateTime }; params: never; response: Announcement };
    "GET /api/v1/community/announcements/:id/reads": { query: Q<{ read?: "read" | "not_read" }>; body: never; params: { id: string }; response: Paged<{ person: PersonRef; read_at: IsoDateTime | null }> };
    "POST /api/v1/community/announcements/:id/remind": { query: never; body: Record<string, never>; params: { id: string }; response: { reminded: number } };
  }
}
