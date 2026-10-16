/**
 * Identity is on the contract (packages/contract/schemas/identity.js): sign-in, the
 * session, /me, passwords, links and sessions are typed by the generated
 * `Endpoints` (api/endpoints.ts). So is the bell (schemas/notifications.js). These
 * are the contract's types under the names the screens use.
 *
 * What stays INTERIM below is ⌘K search, whose route is not built yet.
 */
export type { Me, Session, SignIn, LinkCheck, SecuritySummary, HomeView, RoleRef, Notification, NavBadges } from "@mycity/contract/contract.gen.ts";

/** Actions a role may hold on a module (BACKEND_STRUCTURE §9: module, action, record scope, field). */
export type Grants = Record<string, string[]>;

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
    "GET /api/v1/search": { query: { q: string; page?: number }; body: never; params: never; response: import("./common").Paged<SearchHit> };
  }
}
