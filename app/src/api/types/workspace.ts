import type { IsoDate, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM My Workspace shapes (owner AJ, M2). A24: the line manager sets the week; staff add their own. */
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "urgent" | "high" | "normal" | "low";
export interface Task {
  task_id: Uuid;
  number: string;
  title: string;
  status: TaskStatus;
  owner: PersonRef;
  set_by: PersonRef | null;
  due: IsoDate | null;
  priority: Priority;
  linked: { kind: "kpi" | "partner" | "vacancy"; label: string; link: string } | null;
  due_pill: { tone: Tone; text: string };
  description: string | null;
}
export interface TaskBody {
  title: string;
  owner_id?: Uuid;
  due?: IsoDate;
  priority: Priority;
  description?: string;
}
export interface DiaryItem {
  time: string;
  title: string;
  sub: string;
  confirmed: boolean;
}
export interface TodayView {
  date: IsoDate;
  kpis: Array<{ key: string; label: string; value: string; tone?: Tone }>;
  my_day: Task[];
  set_by_manager: Task[];
  diary: DiaryItem[];
  activity: Array<{ title: string; when: string; text?: string; tone?: "hi" | "ok" }>;
}
export interface CalendarEvent {
  event_id: Uuid;
  date: IsoDate;
  title: string;
  kind: string;
  highlight: boolean;
  link: string | null;
}
export interface WorkspaceAnalytics {
  kpis: Array<{ key: string; label: string; value: string; tone?: Tone; trend?: string; dir?: "up" | "dn" | "fl" }>;
  completed_per_week: number[];
  workload: Array<{ label: string; pct: number; value: string }>;
  priority: Array<{ label: string; pct: number; value: string; emphasis?: "warn" }>;
  late_reasons: Array<{ reason: string; count: number; pct: number }>;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/workspace/today": { query: never; body: never; params: never; response: TodayView };
    "GET /api/v1/tasks": { query: Q<{ status?: TaskStatus; scope?: "mine" | "team" }>; body: never; params: never; response: Paged<Task> };
    "GET /api/v1/tasks/summary": { query: { scope?: "mine" | "team" }; body: never; params: never; response: { kpis: Array<{ key: string; label: string; value: string; tone?: Tone }> } };
    "POST /api/v1/tasks": { query: never; body: TaskBody; params: never; response: Task };
    "PATCH /api/v1/tasks/:id": { query: never; body: Partial<TaskBody> & { status?: TaskStatus }; params: { id: string }; response: Task };
    "GET /api/v1/calendar": { query: Q<{ month: string }>; body: never; params: never; response: Paged<CalendarEvent> };
    "POST /api/v1/calendar": { query: never; body: { title: string; date: IsoDate; time?: string; kind: string }; params: never; response: CalendarEvent };
    "GET /api/v1/workspace/analytics": { query: never; body: never; params: never; response: WorkspaceAnalytics };
  }
}
