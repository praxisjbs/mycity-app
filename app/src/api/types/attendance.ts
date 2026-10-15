import type { IsoDate, IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM attendance shapes (owner LA; docs/guides/attendance.md). Replaced by the generated contract. */
export type ClockKind = "in" | "out";
export type CheckResult = "accepted" | "review" | "rejected" | "retry";

export interface AttendanceToday {
  date: IsoDate;
  state: "not_clocked" | "clocked_in" | "complete" | "unavailable";
  unavailable_reason: "leave" | "suspended" | null;
  unavailable_message: string | null;
  clock_in_at: IsoDateTime | null;
  clock_out_at: IsoDateTime | null;
  shift_start: string; // "09:00"
  shift_end: string;
  grace_minutes: number;
  work_pattern: string; // "Hybrid · office and home days"
  location_label: string; // where today's clock must happen
  location_radius_m: number | null;
  policy_ack_pending: { version: number; blocks_clock_in: boolean } | null;
}

export interface ClockBody {
  kind: ClockKind;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  device_label: string;
  explanation?: string;
}

export interface ClockResponse {
  result: CheckResult;
  title: string;
  message: string;
  event_id: Uuid | null;
  case_number: string | null;
}

export interface AttendanceEvent {
  event_id: Uuid;
  employee: PersonRef;
  date: IsoDate;
  clock_in_at: IsoDateTime | null;
  clock_out_at: IsoDateTime | null;
  worked_minutes: number | null;
  location: string;
  status: "on_time" | "late" | "absent" | "leave" | "review" | "remote" | "weekend";
  late_minutes: number;
  note: string | null;
}

export type Arrangement = "Remote" | "Hybrid" | "Field" | "Office-only";
export type Pill = { tone: Tone; text: string };

export interface RegisterRow {
  employee: PersonRef;
  arrangement: Arrangement;
  clock_in: string | null;
  clock_out: string | null;
  expected_location: string;
  matched_location: string | null;
  device: string | null;
  device_status: Pill | null;
  status: Pill;
  exception: string | null;
  case_number: string | null;
}
export interface AttendanceSummary {
  date: IsoDate;
  scope: "all" | "team";
  kpis: Array<{ key: string; label: string; value: string; tone?: Tone }>;
  hours: number[];
  on_time_pct: number;
  donut_text: string;
  filters: Array<{ value: string; label: string; count: number }>;
}
export interface DayDetail {
  employee: PersonRef;
  date: IsoDate;
  arrangement: string;
  shift: string;
  status: Pill;
  hours: string;
  events: Array<{
    event_number: string;
    kind: "in" | "out";
    system_time: string;
    device_time: string | null;
    gps: string;
    accuracy_m: number | null;
    expected: string;
    matched: string;
    distance: string;
    device: string;
    device_status: string;
    result: string;
    exception: string | null;
    policy_version: string;
    source: string;
    superseded: boolean;
  }>;
  case_number: string | null;
}

export interface FieldAssignment {
  assignment_id: Uuid;
  number: string;
  name: string;
  employees: PersonRef[];
  team: string | null;
  client: string;
  sites: Array<{ name: string; radius_m: number }>;
  date: IsoDate;
  start: string;
  end: string;
  approver: string;
  status: "Approved" | "Awaiting manager" | "Completed" | "Rejected";
  note: string | null;
}
export interface FieldAssignmentBody {
  name: string;
  employee_ids: Uuid[];
  client: string;
  site_name: string;
  radius_m: number;
  date: IsoDate;
  start: string;
  end: string;
  note?: string;
}

export interface LocationRequest {
  request_id: Uuid;
  number: string;
  employee: PersonRef;
  type: "Temporary home-location change" | "Remote day" | "Client visit" | "Field correction";
  from: IsoDate;
  to: IsoDate;
  area: string;
  address: string | null;
  radius_m: number;
  reason: string;
  evidence: string | null;
  status: "Draft" | "Awaiting manager" | "Awaiting HR" | "Approved" | "Rejected" | "Expired";
  manager_note: string | null;
  hr_note: string | null;
  history: Array<{ at: IsoDateTime; by: string; text: string }>;
}
export interface LocationRequestBody {
  type: LocationRequest["type"];
  from: IsoDate;
  to: IsoDate;
  address: string;
  reason: string;
  evidence?: string;
}

export interface ReconCase {
  case_id: Uuid;
  number: string;
  employee: PersonRef;
  department: string;
  arrangement: string;
  date: IsoDate;
  type: string;
  status: "Awaiting HR" | "Awaiting manager" | "Awaiting employee" | "Resolved" | "Escalated";
  explanation: string | null;
  manager_note: string | null;
  payroll_impact: "None" | "Possible deduction" | "Overtime" | "Unpaid day";
  suggested_outcome: string;
  evidence: Array<[string, string]>;
}

export interface Device {
  device_id: Uuid;
  employee: PersonRef;
  name: string;
  first_seen: IsoDateTime;
  last_punch: IsoDateTime | null;
  status: "Enrolled" | "Pending Review" | "Blocked" | "Revoked" | "Verification unavailable";
  effect: Pill;
  note: string | null;
}
export interface DeviceSummary {
  counts: Array<{ label: string; value: string; tone?: Tone }>;
  effects: Array<{ state: string; effect: Pill }>;
  policy_version: number;
}

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
export interface WorksiteBody {
  name: string;
  address: string;
  radius_m: number;
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
    "GET /api/v1/attendance/me/today": { query: never; body: never; params: never; response: AttendanceToday };
    "POST /api/v1/attendance/punches": { query: never; body: ClockBody; params: never; response: ClockResponse };
    "GET /api/v1/attendance/me": { query: Q<{ month?: string; status?: string }>; body: never; params: never; response: Paged<AttendanceEvent> };
    "GET /api/v1/attendance/me/summary": { query: { month?: string }; body: never; params: never; response: { kpis: Array<{ key: string; label: string; value: string; tone?: Tone; sub?: string }>; open_cases: ReconCase[] } };
    "GET /api/v1/attendance/register": { query: Q<{ filter?: string; scope?: "all" | "team" }>; body: never; params: never; response: Paged<RegisterRow> };
    "GET /api/v1/attendance/summary": { query: { scope?: "all" | "team" }; body: never; params: never; response: AttendanceSummary };
    "GET /api/v1/attendance/register/:employee_id": { query: { date?: string }; body: never; params: { employee_id: string }; response: DayDetail };
    "GET /api/v1/attendance/assignments": { query: Q<{ status?: string }>; body: never; params: never; response: Paged<FieldAssignment> };
    "POST /api/v1/attendance/assignments": { query: never; body: FieldAssignmentBody; params: never; response: FieldAssignment };
    "POST /api/v1/attendance/assignments/:id/approve": { query: never; body: Record<string, never>; params: { id: string }; response: FieldAssignment };
    "GET /api/v1/attendance/location-requests": { query: Q<{ scope?: "own" | "team" | "all"; status?: string }>; body: never; params: never; response: Paged<LocationRequest> };
    "POST /api/v1/attendance/location-requests": { query: never; body: LocationRequestBody; params: never; response: LocationRequest };
    "POST /api/v1/attendance/location-requests/:id/recommendation": { query: never; body: { recommend: boolean; note: string }; params: { id: string }; response: LocationRequest };
    "POST /api/v1/attendance/location-requests/:id/decision": { query: never; body: { approve: boolean; note?: string }; params: { id: string }; response: LocationRequest };
    "GET /api/v1/attendance/cases": { query: Q<{ status?: string; type?: string; scope?: "all" | "team" | "own" }>; body: never; params: never; response: Paged<ReconCase> };
    "POST /api/v1/attendance/cases/:id/decision": { query: never; body: { outcome: string; note: string; time?: string }; params: { id: string }; response: ReconCase };
    "POST /api/v1/attendance/cases/:id/explanation": { query: never; body: { explanation: string }; params: { id: string }; response: ReconCase };
    "GET /api/v1/attendance/devices": { query: Q<{ scope?: "own" | "all"; status?: string }>; body: never; params: never; response: Paged<Device> };
    "GET /api/v1/attendance/devices/summary": { query: never; body: never; params: never; response: DeviceSummary };
    "POST /api/v1/attendance/devices": { query: never; body: { name: string; reason?: string }; params: never; response: Device };
    "POST /api/v1/attendance/devices/:id/status": { query: never; body: { status: Device["status"]; reason?: string }; params: { id: string }; response: Device };
    "GET /api/v1/attendance/worksites": { query: Q<{ type?: string }>; body: never; params: never; response: Paged<Worksite> };
    "POST /api/v1/attendance/worksites": { query: never; body: WorksiteBody; params: never; response: Worksite };
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
