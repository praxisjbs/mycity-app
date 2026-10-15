import type { RawRequest, RawResponse } from "../client";

/**
 * The in-browser mock of `/api/public/v1/*`. It answers with the backend's
 * exact envelopes so the pages are built against the real shapes:
 *
 *   list    200 { data: [≤ page size], page: { number, size, total, pages, has_next } }
 *   record  200 the record itself;   create  201 the record
 *   error   { error: { code, message, fields? }, request_id }
 *
 * Every route is anonymous: the public site has no sign-in. Loaded only when
 * VITE_API_MODE=mock; a live build does not include it.
 */
export type Req = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
};
type Handler = (req: Req) => RawResponse | Promise<RawResponse>;

const routes: Array<{ method: string; re: RegExp; names: string[]; handler: Handler }> = [];

/** route("GET /api/public/v1/jobs/:slug", handler) */
export function route(key: string, handler: Handler) {
  const [method, pattern] = key.split(" ");
  const names: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, n: string) => (names.push(n), "([^/]+)"))}$`);
  routes.push({ method, re, names, handler });
}

let reqSeq = 0;
const rid = () => `mock-${Date.now().toString(36)}-${(++reqSeq).toString(36)}`;

export const ok = (body: unknown): RawResponse => ({ status: 200, body });
export const created = (body: unknown): RawResponse => ({ status: 201, body });
export function fail(status: number, code: string, message: string, fields?: Record<string, string[]>): RawResponse {
  return { status, body: { error: { code, message, ...(fields ? { fields } : {}) }, request_id: rid() } };
}
export function invalid(fields: Record<string, string[]>): RawResponse {
  return fail(422, "VALIDATION_FAILED", "Check the highlighted fields", fields);
}

export const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** One page of a list, searched and paged here as the server would. Unknown query keys are refused. */
export function paged<T>(rows: T[], req: Req, search?: (row: T) => unknown[]): RawResponse {
  for (const k of Object.keys(req.query)) if (!["page", "q"].includes(k)) return invalid({ [k]: ["is not a filter on this list"] });
  const q = fold(req.query.q).trim();
  const out = q && search ? rows.filter((r) => search(r).some((v) => fold(v).includes(q))) : rows;
  const size = __CONTRACT_PAGE_SIZE__;
  const n = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
  const pages = Math.ceil(out.length / size);
  return ok({ data: out.slice((n - 1) * size, n * size), page: { number: n, size, total: out.length, pages, has_next: n < pages } });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function dispatch(req: RawRequest): Promise<RawResponse> {
  await wait(90 + Math.random() * 160);
  /* A literal path beats a parameter. */
  const ordered = [...routes].sort((a, b) => a.names.length - b.names.length);
  for (const r of ordered) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(req.path);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const query = Object.fromEntries(
      Object.entries(req.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    try {
      return await r.handler({ method: req.method, path: req.path, params, query, body: (req.body ?? {}) as Record<string, unknown> });
    } catch (err) {
      console.error("[mock api]", req.method, req.path, err);
      return fail(500, "INTERNAL_ERROR", "Something went wrong on our side. Try again.");
    }
  }
  return fail(404, "NOT_FOUND", "There is nothing at this address.");
}

/* Dates relative to now, so the demo never goes stale. */
const DAY = 86400000;
export const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
export const inMinutes = (n: number) => new Date(Date.now() + n * 60000).toISOString();
