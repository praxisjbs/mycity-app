import type { ErrorBody } from "./types/common";
import { noteEnvironmentHeader } from "@/lib/environment";
import type { BodyOf, EndpointKey, ParamsOf, QueryOf, ResponseOf } from "./endpoints";

/**
 * The one way the app talks to the API (FRONTEND_GUIDE §3, §9.5).
 *
 *   api.call("GET /api/v1/employees", { query: { page: 2, q: "ada" } })
 *   api.call("PATCH /api/v1/employees/:id", { params: { id }, body })
 *
 * Auth is the backend's: a 15-minute access token held in memory, and a
 * refresh cookie (HttpOnly, host-only) the browser sends to /auth/refresh. On a
 * 401 the client refreshes once and retries; if that fails the session ends.
 *
 * VITE_API_MODE=mock answers from the in-browser mock API instead of the
 * network. The mock module is loaded only in that mode, so a live build does
 * not carry it.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string[]>;
  requestId?: string;
  reference?: string;

  constructor(status: number, body: ErrorBody | null) {
    super(body?.error.message ?? "Something went wrong on our side. Try again.");
    this.status = status;
    this.code = body?.error.code ?? (status === 0 ? "NETWORK" : "INTERNAL_ERROR");
    this.fields = body?.error.fields ?? {};
    this.requestId = body?.request_id;
    this.reference = body?.error.reference;
  }
}

type Opts<K extends EndpointKey> = {
  query?: QueryOf<K>;
  body?: BodyOf<K>;
  params?: ParamsOf<K>;
  signal?: AbortSignal;
  /** Sent as Idempotency-Key on writes that must not repeat (a send, a payment). */
  idempotencyKey?: string;
};

export interface RawRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string>;
}
export interface RawResponse {
  status: number;
  body: unknown;
}

let accessToken: string | null = null;
let onSessionEnded: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export const session = {
  setToken(token: string | null) {
    accessToken = token;
  },
  get token() {
    return accessToken;
  },
  onEnded(fn: () => void) {
    onSessionEnded = fn;
  },
};

const MOCK = import.meta.env.VITE_API_MODE === "mock";
let mockTransport: ((req: RawRequest) => Promise<RawResponse>) | null = null;

async function transport(req: RawRequest): Promise<RawResponse> {
  if (MOCK) {
    if (!mockTransport) mockTransport = (await import("./mock")).mockTransport;
    return mockTransport(req);
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = `${req.path}${qs.toString() ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers: { Accept: "application/json", ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}), ...req.headers },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      credentials: "include",
    });
  } catch {
    return { status: 0, body: { error: { code: "NETWORK", message: "You appear to be offline. Check the connection and try again." } } };
  }
  noteEnvironmentHeader(res.headers.get("X-Mycity-Environment"));
  const text = res.status === 204 ? "" : await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function build<K extends EndpointKey>(key: K, opts: Opts<K>): RawRequest {
  const space = key.indexOf(" ");
  const method = key.slice(0, space);
  const params = (opts.params ?? {}) as Record<string, string>;
  const path = key.slice(space + 1).replace(/:([a-z_]+)/g, (_, name: string) => {
    const v = params[name];
    if (v == null) throw new Error(`api.call(${key}): missing path param "${name}"`);
    return encodeURIComponent(v);
  });
  return {
    method,
    path,
    query: (opts.query ?? {}) as Record<string, unknown>,
    body: opts.body,
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}) },
  };
}

/** Try the refresh cookie once. Concurrent 401s share one refresh. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = transport({ method: "POST", path: "/api/v1/auth/refresh", query: {}, body: {}, headers: {} })
      .then((res) => {
        const token = (res.body as { access_token?: string } | null)?.access_token;
        if (res.status === 200 && token) {
          accessToken = token;
          return true;
        }
        accessToken = null;
        return false;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function call<K extends EndpointKey>(key: K, opts: Opts<K> = {}): Promise<ResponseOf<K>> {
  let res = await transport(build(key, opts));
  const isAuthRoute = key.includes("/api/v1/auth/");
  if (res.status === 401 && !isAuthRoute) {
    if (await refreshSession()) res = await transport(build(key, opts));
    else onSessionEnded?.();
  }
  if (res.status >= 200 && res.status < 300) return res.body as ResponseOf<K>;
  throw new ApiError(res.status, res.body as ErrorBody | null);
}

export const api = { call };
