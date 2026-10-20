/**
 * INTERIM shapes for the Settings screens still on the mock: Approvals (track D) and
 * Appearance (M9). Organisation, Roles & Permissions, Notifications, Documents & Numbering,
 * Integrations, Security and the Audit Log are on the contract
 * (contract.gen.ts).
 */
export interface Appearance {
  theme_default: "system" | "light" | "dark";
  /** Brand colours by token; the screen reads the value from the stylesheet. */
  palette: Array<{ name: string; token: string }>;
  dark: Array<{ name: string; token: string; note: string }>;
  typeface: string;
}
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/settings/appearance": { query: never; body: never; params: never; response: Appearance };
    "PATCH /api/v1/settings/appearance": { query: never; body: { theme_default: Appearance["theme_default"] }; params: never; response: Appearance };
  }
}
