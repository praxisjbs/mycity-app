/**
 * Identity is on the contract (packages/contract/schemas/identity.js): sign-in, the
 * session, /me, passwords, links and sessions are typed by the generated
 * `Endpoints` (api/endpoints.ts). So are the bell (schemas/notifications.js) and ⌘K
 * search (schemas/search.js). These are the contract's types under the names the
 * screens use.
 */
export type { Me, Session, SignIn, LinkCheck, SecuritySummary, HomeView, RoleRef, Notification, NavBadges } from "@mycity/contract/contract.gen.ts";

/** Actions a role may hold on a module (BACKEND_STRUCTURE §9: module, action, record scope, field). */
export type Grants = Record<string, string[]>;
