import type { IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * INTERIM attendance shapes (owner LA; docs/guides/attendance.md) for the screens whose API is
 * not built yet: Policy Updates (#89), Settings · Attendance Policy (M9) and the employee's
 * attendance setup. The clock, the days, the register, the exceptions, the devices, the
 * worksites and work location requests are on the generated contract.
 */
export type Arrangement = "Remote" | "Hybrid" | "Field" | "Office-only";
export type Pill = { tone: Tone; text: string };

/** The offices the employee setup tab offers (INTERIM; the worksites themselves are on the contract). */
export interface Worksite {
  location_id: Uuid;
  name: string;
  type: "Office" | "Approved home" | "Temporary location" | "Field assignment";
  address: string;
  radius_m: number;
  assigned: string;
  attendance_today: number;
  dates: string;
  mode: string;
  status: string;
  status_tone: Tone;
  /** Schematic map position, 0 to 1000 by 0 to 300. Homes are masked to their area. */
  map: { x: number; y: number } | null;
}
export interface PolicySetting {
  key: string;
  label: string;
  help: string;
  section: string;
  kind: "bool" | "mode" | "number" | "time" | "select" | "locked";
  value: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
}
export interface AttendancePolicy {
  version: number;
  published_at: IsoDateTime;
  published_by: string;
  summary: string;
  changes: string[];
  settings: PolicySetting[];
  acknowledged_at: IsoDateTime | null;
  draft: { changed_keys: string[]; settings: PolicySetting[] } | null;
}

export interface EmployeeAttendanceSetup {
  employee: PersonRef;
  arrangement: Arrangement;
  primary_location: string;
  office: string;
  office_radius_m: number;
  home_area: string | null;
  home_address: string | null;
  home_radius_m: number | null;
  field_assignment_today: string | null;
  temporary_location: Pill;
  schedule: Record<string, "Office" | "Remote"> | null;
  profile: string;
  history: Array<{ title: string; when: string; text: string }>;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/attendance/worksites": { query: Q<{ type?: string }>; body: never; params: never; response: Paged<Worksite> };
    "GET /api/v1/attendance/policies": { query: Q; body: never; params: never; response: Paged<AttendancePolicy> };
    "GET /api/v1/attendance/policies/current": { query: never; body: never; params: never; response: AttendancePolicy };
    "PATCH /api/v1/attendance/policies/draft": { query: never; body: { settings: Record<string, string | number | boolean> }; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/draft/discard": { query: never; body: Record<string, never>; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/publish": { query: never; body: { summary: string }; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/:version/acknowledge": { query: never; body: Record<string, never>; params: { version: string }; response: AttendancePolicy };
    "GET /api/v1/attendance/setup/:employee_id": { query: never; body: never; params: { employee_id: string }; response: EmployeeAttendanceSetup };
    "PATCH /api/v1/attendance/setup/:employee_id": { query: never; body: { arrangement?: Arrangement; schedule?: Record<string, "Office" | "Remote">; office?: string; reason: string }; params: { employee_id: string }; response: EmployeeAttendanceSetup };
  }
}
