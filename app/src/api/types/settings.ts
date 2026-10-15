import type { IsoDate, IsoDateTime, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status } from "./performance";

/** INTERIM Settings and audit shapes (owner TB; MILESTONES §16). Configuration is data; changing it needs no deploy. */
export interface Organisation {
  legal_name: string;
  trading_name: string;
  country: string;
  currency: string;
  time_zone: string;
  financial_year: string;
  hosts: Array<[string, string]>;
  about: Array<[string, string]>;
  week: Array<{ day: string; working: boolean; start: string | null; end: string | null; grace_min: number | null }>;
  holidays: Array<{ date: IsoDate; name: string }>;
}
export interface UserRow {
  user_id: Uuid;
  person: PersonRef;
  email: string;
  role: string;
  last_seen: IsoDateTime | null;
  mfa: boolean;
  status: Status;
}
export interface UsersSummary {
  users: number;
  active_now: number;
  pending: number;
  mfa: number;
  by_role: BarRow[];
}
export interface Role {
  role_id: Uuid;
  name: string;
  users: number;
  modules: number;
  /** The widest record scope the role holds anywhere, or Mixed when it differs by module. */
  scope: "All" | "Team" | "Own" | "Mixed";
  sensitive: "Visible" | "Masked" | "Partly";
  /** A built-in role: it cannot be renamed or deleted. */
  system: boolean;
}

/**
 * The four layers (MILESTONES §14): module → action → record scope → field.
 * There is no entity layer: one company (A2). The action is spelled `edit`.
 */
export type RoleAction = "view" | "create" | "edit" | "delete" | "approve" | "export";
export type RecordScope = "all" | "team" | "own";
export interface RoleGrant {
  module: string;
  actions: RoleAction[];
  scope: RecordScope;
}
/** What can be granted: the access catalogue (`access.catalog`), one entry per module. */
export interface AccessCatalogue {
  modules: Array<{ key: string; label: string; actions: RoleAction[]; scoped: boolean }>;
  fields: Array<{ key: string; label: string; help: string }>;
}
export interface RoleDetail {
  role_id: Uuid;
  name: string;
  description: string;
  system: boolean;
  /** The CEO role holds everything and is not editable. */
  locked: boolean;
  users: number;
  grants: RoleGrant[];
  /** Sensitive fields this role sees unmasked. Everything else in `AccessCatalogue.fields` is masked. */
  visible_fields: string[];
}
export interface RoleBody {
  name: string;
  description: string;
  grants: RoleGrant[];
  visible_fields: string[];
}
export interface Matrix {
  roles: string[];
  rows: Array<{ module: string; cells: string[] }>;
}
export interface Hierarchy {
  hierarchy_id: Uuid;
  name: string;
  description: string;
  steps: string[];
  trigger: string;
  deputies: string;
  ageing: string;
  status: Status;
}
export interface HierarchiesSummary {
  hierarchies: number;
  active: number;
  awaiting: number;
  longest: number;
}
export interface NotificationPref {
  key: string;
  label: string;
  help: string;
  in_app: boolean;
  email: boolean;
  locked: boolean;
}
export interface Appearance {
  theme_default: "system" | "light" | "dark";
  /** Brand colours by token; the screen reads the value from the stylesheet. */
  palette: Array<{ name: string; token: string }>;
  dark: Array<{ name: string; token: string; note: string }>;
  typeface: string;
}
export interface Numbering {
  key: string;
  document: string;
  prefix: string;
  format: string;
  next: string;
}
export interface NumberingSummary {
  types: number;
  templates: number;
  issued_this_year: number;
  signed: number;
}
export interface Integration {
  key: string;
  name: string;
  text: string;
  status: Status;
}
export interface IntegrationHealth {
  service: string;
  last_call: IsoDateTime | null;
  volume_7d: number;
  failures: number;
  status: Status;
}
export interface SecurityPolicy {
  active_sessions: number;
  mfa_enrolled: number;
  users: number;
  failed_7d: number;
  devices: number;
  rules: Array<{ key: string; label: string; on: boolean }>;
}
export interface Session {
  session_id: Uuid;
  person: PersonRef;
  device: string;
  started_at: IsoDateTime;
}
export interface FailedLogin {
  attempt_id: Uuid;
  at: IsoDateTime;
  email: string;
  place: string;
  outcome: Status;
}
export interface AuditEntry {
  audit_id: Uuid;
  at: IsoDateTime;
  actor: string;
  action: string;
  entity: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  module: string;
}
export interface AuditSummary {
  today: number;
  this_month: number;
  modules: string[];
  by_module: BarRow[];
  retention: string;
}
export interface PolicyAck {
  employee: PersonRef;
  read_at: IsoDateTime | null;
  acknowledged_at: IsoDateTime | null;
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/settings/organisation": { query: never; body: never; params: never; response: Organisation };
    "PATCH /api/v1/settings/organisation": { query: never; body: { trading_name?: string; week?: Organisation["week"] }; params: never; response: Organisation };
    "GET /api/v1/settings/users/summary": { query: never; body: never; params: never; response: UsersSummary };
    "GET /api/v1/settings/users": { query: Q<{ role?: string }>; body: never; params: never; response: Paged<UserRow> };
    "POST /api/v1/settings/users/invite": { query: never; body: { employee_id: Uuid; role: string }; params: never; response: UserRow };
    "POST /api/v1/settings/users/:id/role": { query: never; body: { role: string }; params: { id: string }; response: UserRow };
    "POST /api/v1/settings/users/:id/disable": { query: never; body: { reason: string }; params: { id: string }; response: UserRow };
    "GET /api/v1/settings/roles": { query: Q; body: never; params: never; response: Paged<Role> };
    "GET /api/v1/settings/roles/matrix": { query: never; body: never; params: never; response: Matrix };
    "GET /api/v1/settings/roles/catalogue": { query: never; body: never; params: never; response: AccessCatalogue };
    "GET /api/v1/settings/roles/:id": { query: never; body: never; params: { id: string }; response: RoleDetail };
    "POST /api/v1/settings/roles": { query: never; body: RoleBody; params: never; response: RoleDetail };
    "PUT /api/v1/settings/roles/:id": { query: never; body: RoleBody; params: { id: string }; response: RoleDetail };
    "DELETE /api/v1/settings/roles/:id": { query: never; body: never; params: { id: string }; response: null };
    "GET /api/v1/settings/approvals/summary": { query: never; body: never; params: never; response: HierarchiesSummary };
    "GET /api/v1/settings/approvals": { query: Q; body: never; params: never; response: Paged<Hierarchy> };
    "PUT /api/v1/settings/approvals/:id/steps": { query: never; body: { steps: string[] }; params: { id: string }; response: Hierarchy };
    "GET /api/v1/settings/notifications": { query: never; body: never; params: never; response: NotificationPref[] };
    "PATCH /api/v1/settings/notifications": { query: never; body: Record<string, { in_app: boolean; email: boolean }>; params: never; response: NotificationPref[] };
    "GET /api/v1/settings/appearance": { query: never; body: never; params: never; response: Appearance };
    "PATCH /api/v1/settings/appearance": { query: never; body: { theme_default: Appearance["theme_default"] }; params: never; response: Appearance };
    "GET /api/v1/settings/numbering/summary": { query: never; body: never; params: never; response: NumberingSummary };
    "GET /api/v1/settings/numbering": { query: Q; body: never; params: never; response: Paged<Numbering> };
    "GET /api/v1/settings/integrations": { query: never; body: never; params: never; response: { items: Integration[]; health: IntegrationHealth[] } };
    "GET /api/v1/settings/security": { query: never; body: never; params: never; response: SecurityPolicy };
    "PATCH /api/v1/settings/security": { query: never; body: Record<string, boolean>; params: never; response: SecurityPolicy };
    "GET /api/v1/settings/security/sessions": { query: Q; body: never; params: never; response: Paged<Session> };
    "POST /api/v1/settings/security/sessions/:id/end": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "GET /api/v1/settings/security/failed-logins": { query: Q; body: never; params: never; response: Paged<FailedLogin> };
    "GET /api/v1/audit/summary": { query: never; body: never; params: never; response: AuditSummary };
    "GET /api/v1/audit": { query: Q<{ module?: string }>; body: never; params: never; response: Paged<AuditEntry> };
    "GET /api/v1/attendance/policies/:version/acknowledgements": { query: Q; body: never; params: { version: string }; response: Paged<PolicyAck> };
  }
}
