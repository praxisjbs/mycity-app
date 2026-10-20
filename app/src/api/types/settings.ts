import type { IsoDateTime } from "./common";
import type { Status } from "./performance";

/**
 * INTERIM shapes for the Settings screens still on the mock: Approvals (track D),
 * Notifications (M6), Appearance and Integrations (M9). Organisation, Roles & Permissions,
 * Documents & Numbering, Security, the Audit Log and the attendance policy (LA) are on the
 * contract (contract.gen.ts).
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

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/settings/notifications": { query: never; body: never; params: never; response: NotificationPref[] };
    "PATCH /api/v1/settings/notifications": { query: never; body: Record<string, { in_app: boolean; email: boolean }>; params: never; response: NotificationPref[] };
    "GET /api/v1/settings/appearance": { query: never; body: never; params: never; response: Appearance };
    "PATCH /api/v1/settings/appearance": { query: never; body: { theme_default: Appearance["theme_default"] }; params: never; response: Appearance };
    "GET /api/v1/settings/integrations": { query: never; body: never; params: never; response: { items: Integration[]; health: IntegrationHealth[] } };
  }
}
