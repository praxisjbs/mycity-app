import type { RawRequest, RawResponse } from "../client";
import { todayIso } from "@mycity/ui";

/**
 * The in-browser mock API. It answers with the backend's exact envelopes so the
 * screens are built against the real shapes:
 *
 *   list    200 { data: [≤ page size], page: { number, size, total, pages, has_next } }
 *   record  200 the record itself
 *   create  201 the record;   queued work  202 { job_id };   no body  204
 *   error   { error: { code, message, fields? }, request_id }
 *
 * Search (`q`) and filters are applied HERE, standing in for the server, never
 * by a screen. The page size is the contract's (__CONTRACT_PAGE_SIZE__).
 *
 * Loaded only when VITE_API_MODE=mock; a live build does not include it.
 */
export type Req = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  user: string | null;
  idempotency_key?: string;
};
type Handler = (req: Req) => RawResponse | Promise<RawResponse>;

const routes: Array<{ method: string; re: RegExp; names: string[]; handler: Handler; anonymous: boolean }> = [];

/** route("GET /api/v1/employees/:id", handler) */
export function route(key: string, handler: Handler, opts: { anonymous?: boolean } = {}) {
  const [method, pattern] = key.split(" ");
  const names: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, n: string) => (names.push(n), "([^/]+)"))}$`);
  routes.push({ method, re, names, handler, anonymous: !!opts.anonymous });
}

/**
 * Marks the mock in a build. scripts/check/mock-free.js (F12) builds this app for
 * release and fails if the string is anywhere in the output: a release build
 * never carries the in-browser mock. Used below, so a mock build keeps it.
 */
export const MOCK_SENTINEL = "mycity-in-browser-mock:app";

let reqSeq = 0;
const rid = () => `mock-${Date.now().toString(36)}-${(++reqSeq).toString(36)}`;

export const ok = (body: unknown): RawResponse => ({ status: 200, body });
export const created = (body: unknown): RawResponse => ({ status: 201, body });
export const accepted = (): RawResponse => ({ status: 202, body: { job_id: uuid() } });
export const noContent = (): RawResponse => ({ status: 204, body: null });
export function fail(status: number, code: string, message: string, fields?: Record<string, string[]>): RawResponse {
  return { status, body: { error: { code, message, ...(fields ? { fields } : {}) }, request_id: rid() } };
}
export const notFound = () => fail(404, "NOT_FOUND", "That record does not exist, or you cannot see it.");

/** 422 with per-field messages, the way error-handler.js sends a Zod failure. */
export function invalid(fields: Record<string, string[]>): RawResponse {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields", fields);
}

/** Lower-case, accent-free, for search the way the backend's search_fold() does it. */
export const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * One page of a list. `search` names the text a row is matched on; `filters`
 * maps a query key to a test; `sort` maps each field the list's contract
 * allow-lists to a comparison, so `?sort=-display_name` is answered here and
 * never by a screen (F20). Unknown query keys, and a sort field the list does
 * not name, are refused with a 422 naming the key, as the API's `.strict()`
 * list schemas do.
 */
export function paged<T>(
  rows: T[],
  req: Req,
  opts: {
    search?: (row: T) => unknown[];
    filters?: Record<string, (row: T, value: string) => boolean>;
    sort?: Record<string, (a: T, b: T) => number>;
  } = {},
): RawResponse {
  const sortable = opts.sort ?? {};
  const allowed = new Set(["page", "q", ...Object.keys(opts.filters ?? {}), ...(Object.keys(sortable).length ? ["sort"] : [])]);
  for (const k of Object.keys(req.query)) {
    if (!allowed.has(k)) return invalid({ [k]: ["is not a filter on this list"] });
  }
  let out = rows;
  const q = fold(req.query.q).trim();
  if (q && opts.search) out = out.filter((r) => opts.search!(r).some((v) => fold(v).includes(q)));
  for (const [k, test] of Object.entries(opts.filters ?? {})) {
    const v = req.query[k];
    if (v !== undefined && v !== "" && v !== "all") out = out.filter((r) => test(r, v));
  }
  const asked = req.query.sort;
  if (asked) {
    const field = asked.replace(/^-/, "");
    const compare = sortable[field];
    if (!compare) return invalid({ sort: ["is not a field this list sorts by"] });
    out = [...out].sort(asked.startsWith("-") ? (a, b) => compare(b, a) : compare);
  } else if (Object.keys(sortable).length) {
    const first = Object.values(sortable)[0];
    out = [...out].sort(first);
  }
  const size = __CONTRACT_PAGE_SIZE__;
  const n = Math.max(1, Math.min(100000, Number.parseInt(req.query.page ?? "1", 10) || 1));
  const total = out.length;
  const pages = Math.ceil(total / size);
  return ok({ data: out.slice((n - 1) * size, n * size), page: { number: n, size, total, pages, has_next: n < pages } });
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** A stable uuid from a seed, so fixture ids survive a reload and links keep working. */
export function sid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 2246822507);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2));
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

const SESSION_KEY = "mc-mock-session";
export const mockSession = {
  get(): string | null {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(user: string | null) {
    try {
      if (user) sessionStorage.setItem(SESSION_KEY, user);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* a blocked store only means signing in again after a reload */
    }
  },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function dispatch(req: RawRequest): Promise<RawResponse> {
  /* Who asks is fixed when the request arrives, as on the server: an answer still on its way when someone else signs in is the sender's. */
  const sender = mockSession.get();
  await wait(90 + Math.random() * 160);
  /* A literal path beats a parameter: /queries/rules is never /queries/:id. */
  const ordered = [...routes].sort((a, b) => a.names.length - b.names.length);
  for (const r of ordered) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(req.path);
    if (!m) continue;
    const user = sender;
    const bearer = req.headers.Authorization?.startsWith("Bearer mock.");
    if (!r.anonymous && (!user || !bearer)) return fail(401, "UNAUTHENTICATED", "Sign in to continue.");
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const query = Object.fromEntries(
      Object.entries(req.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    try {
      return await r.handler({ method: req.method, path: req.path, params, query, body: (req.body ?? {}) as Record<string, unknown>, user, idempotency_key: req.headers["Idempotency-Key"] });
    } catch (err) {
      console.error(`[${MOCK_SENTINEL}]`, req.method, req.path, err);
      return fail(500, "INTERNAL_ERROR", "Something went wrong on our side. Try again, and quote this reference if it keeps happening.");
    }
  }
  return fail(404, "NOT_FOUND", `Nothing at ${req.method} ${req.path}`);
}

/* ------------------------------------------------------------------ *
 * Fixture helpers: dates relative to today, so the demo never goes stale.
 * ------------------------------------------------------------------ */
const DAY = 86400000;
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
/** The Lagos calendar day, as the backend keeps dates. */
export const isoDay = (d: Date) => todayIso(d);
export const isoDaysAgo = (n: number) => isoDay(daysAgo(n));
export const isoDaysAhead = (n: number) => isoDay(daysAgo(-n));
/** A Lagos time today (or n days ago) as an ISO timestamp: at(0, "09:14"). */
export function at(daysBack: number, hm: string): string {
  const d = isoDay(daysAgo(daysBack));
  return new Date(`${d}T${hm}:00+01:00`).toISOString();
}
/** Pick from a list by a seed number, deterministically. */
export const pick = <T,>(list: readonly T[], n: number) => list[Math.abs(n) % list.length];
