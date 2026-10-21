import type { IsoDateTime, Paged, PersonRef } from "./common";
import type { Status } from "./shared";

/**
 * INTERIM shapes for the Settings screens still on the mock: Approvals (track D),
 * Notifications (M6), Appearance and Integrations (M9), and the attendance policy
 * acknowledgements (LA). Organisation, Roles & Permissions, Documents & Numbering,
 * Security and the Audit Log are on the contract (contract.gen.ts).
 */
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
export interface PolicyAck {
  employee: PersonRef;
  read_at: IsoDateTime | null;
  acknowledged_at: IsoDateTime | null;
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/settings/notifications": { query: never; body: never; params: never; response: NotificationPref[] };
    "PATCH /api/v1/settings/notifications": { query: never; body: Record<string, { in_app: boolean; email: boolean }>; params: never; response: NotificationPref[] };
    "GET /api/v1/settings/appearance": { query: never; body: never; params: never; response: Appearance };
    "PATCH /api/v1/settings/appearance": { query: never; body: { theme_default: Appearance["theme_default"] }; params: never; response: Appearance };
    "GET /api/v1/settings/integrations": { query: never; body: never; params: never; response: { items: Integration[]; health: IntegrationHealth[] } };
    "GET /api/v1/attendance/policies/:version/acknowledgements": { query: Q; body: never; params: { version: string }; response: Paged<PolicyAck> };
  }
}
