import type { IsoDateTime, Paged } from "./common";

/**
 * INTERIM attendance shapes (owner LA; docs/guides/attendance.md) for the screens whose API is
 * not built yet: Policy Updates (#89) and Settings · Attendance Policy (M9). The clock, the days,
 * the register, the exceptions, the devices, the worksites, work location requests, field
 * assignments and each person's week (the employee record's Attendance tab) are on the
 * generated contract.
 */
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

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/attendance/policies": { query: Q; body: never; params: never; response: Paged<AttendancePolicy> };
    "GET /api/v1/attendance/policies/current": { query: never; body: never; params: never; response: AttendancePolicy };
    "PATCH /api/v1/attendance/policies/draft": { query: never; body: { settings: Record<string, string | number | boolean> }; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/draft/discard": { query: never; body: Record<string, never>; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/publish": { query: never; body: { summary: string }; params: never; response: AttendancePolicy };
    "POST /api/v1/attendance/policies/:version/acknowledge": { query: never; body: Record<string, never>; params: { version: string }; response: AttendancePolicy };
  }
}
