import type { IsoDateTime, Uuid } from "./common";

/** Actions a role may hold on a module (BACKEND_STRUCTURE §9: module, action, record scope, field). */
export type Grants = Record<string, string[]>;

export interface Me {
  user_id: Uuid;
  employee_id: Uuid;
  email: string;
  display_name: string;
  job_title: string;
  department: string;
  photo_url: string | null;
  is_ceo: boolean;
  /** Module key → actions. The shell shows only what is granted; the API enforces. */
  grants: Grants;
  /** Home's role view: which KPI set and main chart the API serves (docs/guides/home.md). */
  home_view: "operations" | "ceo" | "partnerships" | "staff";
  /** Does this person manage anyone? Opens Home · Team and the manager views. */
  manages_people: boolean;
}

export interface Session {
  access_token: string;
  expires_in: number;
  user: Me;
}

export interface LoginBody {
  email: string;
  password: string;
}

/** Sign-in splash figures (anonymous; counts only, no names). INTERIM: proposed endpoint. */
export interface Splash {
  staff: number;
  cities: number;
  partnerships: number;
}

/** Badge counts on the rail, per module key. */
export type NavBadges = Record<string, number>;

export interface Notification {
  notification_id: Uuid;
  category: string;
  title: string;
  body: string;
  created_at: IsoDateTime;
  read_at: IsoDateTime | null;
  tone: "ok" | "warn" | "err" | "info";
  link: { path: string } | null;
}

/** ⌘K results from the search registry (src/shared/search). */
export interface SearchHit {
  kind: "screen" | "record";
  title: string;
  subtitle: string;
  group: string;
  path: string;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "POST /api/v1/auth/login": { query: never; body: LoginBody; params: never; response: Session };
    "POST /api/v1/auth/refresh": { query: never; body: Record<string, never>; params: never; response: Session };
    "GET /api/v1/auth/splash": { query: never; body: never; params: never; response: Splash };
    "POST /api/v1/auth/logout": { query: never; body: Record<string, never>; params: never; response: null };
    "GET /api/v1/auth/me": { query: never; body: never; params: never; response: Me };
    "GET /api/v1/notifications/badges": { query: never; body: never; params: never; response: NavBadges };
    "GET /api/v1/notifications": { query: { page?: number; unread?: boolean }; body: never; params: never; response: import("./common").Paged<Notification> };
    "POST /api/v1/notifications/read-all": { query: never; body: Record<string, never>; params: never; response: null };
    "GET /api/v1/search": { query: { q: string; page?: number }; body: never; params: never; response: import("./common").Paged<SearchHit> };
  }
}
