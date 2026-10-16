import type { IsoDateTime, Uuid } from "./common";

/**
 * Identity is on the contract (packages/contract/schemas/identity.js): sign-in, the
 * session, /me, passwords, links and sessions are typed by the generated
 * `Endpoints` (api/endpoints.ts). These are the contract's types under the names
 * the screens use.
 *
 * What stays INTERIM below is the shell's bell and ⌘K search, whose modules
 * (notifications, the search route) are not built yet.
 */
export type { Me, Session, SignIn, LinkCheck, SecuritySummary, HomeView, RoleRef } from "@mycity/contract/contract.gen.ts";

/** Actions a role may hold on a module (BACKEND_STRUCTURE §9: module, action, record scope, field). */
export type Grants = Record<string, string[]>;

/** Badge counts on the rail, per module key. */
export type NavBadges = Record<string, number>;

export interface Notification {
  notification_id: Uuid;
  category: string;
  title: string;
  body: string;
  created_at: IsoDateTime;
  read_at: IsoDateTime | null;
  tone: "ok" | "warn" | "err" | "info";
  link: { path: string } | null;
}

/** ⌘K results from the search registry (src/shared/search). */
export interface SearchHit {
  kind: "screen" | "record";
  title: string;
  subtitle: string;
  group: string;
  path: string;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/notifications/badges": { query: never; body: never; params: never; response: NavBadges };
    "GET /api/v1/notifications": { query: { page?: number; unread?: boolean }; body: never; params: never; response: import("./common").Paged<Notification> };
    "POST /api/v1/notifications/read-all": { query: never; body: Record<string, never>; params: never; response: null };
    "GET /api/v1/search": { query: { q: string; page?: number }; body: never; params: never; response: import("./common").Paged<SearchHit> };
  }
}
