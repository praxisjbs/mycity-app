import type { IsoDate, IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM leave shapes (owner AJ). */
export type LeaveType = "Annual" | "Sick" | "Compassionate" | "Maternity" | "Paternity" | "Study" | "Unpaid";
export interface LeaveRequest {
  leave_id: Uuid;
  number: string;
  employee: PersonRef;
  type: LeaveType;
  from: IsoDate;
  to: IsoDate;
  days: number;
  reason: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  approver: string | null;
  submitted_at: IsoDateTime;
}
export interface LeaveBody {
  type: LeaveType;
  from: IsoDate;
  to: IsoDate;
  reason: string;
  employee_id?: Uuid;
}
export interface CoverCheck {
  title: string;
  text: string;
  rows: Array<{ title: string; text: string; tone: Tone; result: string }>;
}
export interface LeaveBalance {
  type: LeaveType;
  entitled: number;
  taken: number;
  booked: number;
  left: number;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/leave/requests": { query: Q<{ scope?: "own" | "team" | "all"; status?: string; type?: string }>; body: never; params: never; response: Paged<LeaveRequest> };
    "GET /api/v1/leave/summary": { query: { scope?: "own" | "all" }; body: never; params: never; response: { kpis: Array<{ key: string; label: string; value: string; tone?: Tone }> } };
    "GET /api/v1/leave/balances": { query: never; body: never; params: never; response: { year: number; balances: LeaveBalance[] } };
    "POST /api/v1/leave/requests": { query: never; body: LeaveBody; params: never; response: LeaveRequest };
    "POST /api/v1/leave/requests/:id/decision": { query: never; body: { approve: boolean; note?: string }; params: { id: string }; response: LeaveRequest };
    "POST /api/v1/leave/requests/:id/cancel": { query: never; body: Record<string, never>; params: { id: string }; response: LeaveRequest };
    "GET /api/v1/leave/requests/:id/cover": { query: never; body: never; params: { id: string }; response: CoverCheck };
  }
}
