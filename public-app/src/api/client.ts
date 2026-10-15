import type { ErrorBody } from "./types/common";
import { noteEnvironmentHeader } from "@/lib/environment";
import type { BodyOf, EndpointKey, ParamsOf, QueryOf, ResponseOf } from "./endpoints";

/**
 * The one way the public site talks to the API: `/api/public/v1/*` only.
 *
 *   api.call("GET /api/public/v1/jobs/:slug", { params: { slug } })
 *
 * No session, no cookie, no token header (SYSTEM_ARCHITECTURE §3): a person is
 * identified by the opaque token in the page's own address, which travels in
 * the path. VITE_API_MODE=mock answers from the in-browser mock instead; a
 * live build does not carry it.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string[]>;
  requestId?: string;

  constructor(status: number, body: ErrorBody | null) {
    super(body?.error.message ?? "Something went wrong on our side. Try again.");
    this.status = status;
    this.code = body?.error.code ?? (status === 0 ? "NETWORK" : "INTERNAL_ERROR");
    this.fields = body?.error.fields ?? {};
    this.requestId = body?.request_id;
  }
}

type Opts<K extends EndpointKey> = { query?: QueryOf<K>; body?: BodyOf<K>; params?: ParamsOf<K> };

export interface RawRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
}
export interface RawResponse {
  status: number;
  body: unknown;
}

const MOCK = import.meta.env.VITE_API_MODE === "mock";
let mockTransport: ((req: RawRequest) => Promise<RawResponse>) | null = null;

async function transport(req: RawRequest): Promise<RawResponse> {
  if (MOCK) {
    if (!mockTransport) mockTransport = (await import("./mock")).mockTransport;
    return mockTransport(req);
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(`${req.path}${qs.toString() ? `?${qs}` : ""}`, {
      method: req.method,
      headers: { Accept: "application/json", ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      credentials: "omit",
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

async function call<K extends EndpointKey>(key: K, opts: Opts<K> = {}): Promise<ResponseOf<K>> {
  const space = key.indexOf(" ");
  const params = (opts.params ?? {}) as Record<string, string>;
  const path = key.slice(space + 1).replace(/:([a-z_]+)/g, (_, name: string) => {
    const v = params[name];
    if (v == null) throw new Error(`api.call(${key}): missing path param "${name}"`);
    return encodeURIComponent(v);
  });
  const res = await transport({ method: key.slice(0, space), path, query: (opts.query ?? {}) as Record<string, unknown>, body: opts.body });
  if (res.status >= 200 && res.status < 300) return res.body as ResponseOf<K>;
  throw new ApiError(res.status, res.body as ErrorBody | null);
}

export const api = { call };
