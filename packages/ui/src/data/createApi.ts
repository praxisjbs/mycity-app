/**
 * The one API client and its data hooks, shared by the staff app and the public
 * site (FRONTEND_GUIDE §3, §4, §9.5). Each app binds it once to its own endpoint
 * map and settings in src/api/client.ts and src/api/hooks.ts; screens import from
 * those files and never from here.
 *
 *   const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", cache: true });
 *   core.api.call("GET /api/v1/employees/:id", { params: { id } });
 *
 * Every call is typed by its key ("METHOD /path") from the app's Endpoints map,
 * the interim types today and packages/contract/contract.gen.ts as modules land.
 * Lists are ALWAYS the server's pages: usePaged sends `page`, `q`, one `sort` and
 * the list's own filters and shows `page.total`; nothing here filters, sorts or
 * slices rows, and no page size is ever sent (the server's is fixed at 25).
 *
 * The mock transport is passed only by a laptop build (VITE_API_MODE=mock); a
 * release build passes none, so it never carries the mock (F12, check/mock-free.js).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* ───── wire types ───── */

/** `page` on every list response (contract common.js PageMeta). */
export interface PageMeta {
  number: number;
  size: number;
  total: number;
  pages: number;
  has_next: boolean;
}

/** Every error body (the API's error handler). */
export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string[]>; reference?: string };
  request_id?: string;
}

/** One endpoint's shapes. */
export interface EndpointShape {
  query: unknown;
  body: unknown;
  params: unknown;
  response: unknown;
}

type Key<E> = keyof E & string;
type Shape<E, K extends Key<E>> = E[K] extends EndpointShape ? E[K] : never;
export type QueryOf<E, K extends Key<E>> = Shape<E, K>["query"];
export type BodyOf<E, K extends Key<E>> = Shape<E, K>["body"];
export type ParamsOf<E, K extends Key<E>> = Shape<E, K>["params"];
export type ResponseOf<E, K extends Key<E>> = Shape<E, K>["response"];
/** Keys whose response is a page envelope. */
export type PagedKeyOf<E> = { [K in Key<E>]: ResponseOf<E, K> extends { data: unknown[]; page: unknown } ? K : never }[Key<E>];
export type RowOf<E, K extends Key<E>> = ResponseOf<E, K> extends { data: Array<infer R> } ? R : never;
/**
 * A list's `sort` value: a field name, with a leading `-` for descending
 * (common.js `sortParam`). The allow-list is the contract's and is enforced
 * where it matters, on the server: a field the list does not name is a 422.
 * The type here is whatever the endpoint declares for the key, and `string`
 * for a list still on INTERIM types with no sort of its own.
 */
export type SortOf<E, K extends Key<E>> = "sort" extends keyof NonNullable<QueryOf<E, K>>
  ? NonNullable<NonNullable<QueryOf<E, K>>["sort"]>
  : string;

/** What a transport receives: the method, the path with its params filled, the query, the body, the headers. */
export interface RawRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string>;
  /** Cancels the request (a search a newer key overtook); the call then rejects with an AbortError. */
  signal?: AbortSignal;
}
export interface RawResponse {
  status: number;
  body: unknown;
}
export type Transport = (req: RawRequest) => Promise<RawResponse>;

/** An error from the API: its status, code, message, per-field messages after a 422, and the request id. */
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string[]>;
  requestId?: string;
  reference?: string;

  constructor(status: number, body: ErrorBody | null) {
    super(body?.error.message ?? "Something went wrong on our side. Try again.");
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error.code ?? (status === 0 ? "NETWORK" : "INTERNAL_ERROR");
    this.fields = body?.error.fields ?? {};
    this.requestId = body?.request_id;
    this.reference = body?.error.reference;
  }
}

export interface ApiConfig {
  /**
   * Staff only: a bearer token held in memory, and one refresh retry on a 401
   * through this path. The refresh token rotates on every use and a rotated one
   * ends the session, so refreshes are taken one at a time across every open tab
   * of the app (the Web Locks API, where the browser has it).
   */
  auth?: { refreshPath: string };
  /** include for the staff app (the refresh cookie), omit for the public site. */
  credentials: RequestCredentials;
  /** Keep the last answer per request, so returning to a screen shows it at once. */
  cache?: boolean;
  /** A laptop build's mock, loaded lazily; never passed by a release build. */
  mock?: () => Promise<Transport>;
  /** Sees every response's headers (the environment marker). */
  onHeaders?: (headers: Headers) => void;
  /** The network transport; fetch unless a test passes its own. */
  transport?: Transport;
}

const OFFLINE: RawResponse = { status: 0, body: { error: { code: "NETWORK", message: "You appear to be offline. Check the connection and try again." } } };

function fetchTransport(credentials: RequestCredentials, onHeaders?: (h: Headers) => void): Transport {
  return async (req) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    let res: Response;
    try {
      res = await fetch(`${req.path}${qs.toString() ? `?${qs}` : ""}`, {
        method: req.method,
        headers: { Accept: "application/json", ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}), ...req.headers },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        credentials,
        signal: req.signal,
      });
    } catch (err) {
      // A request the caller cancelled is not the network failing: the caller drops it.
      if (req.signal?.aborted) throw err;
      return OFFLINE;
    }
    onHeaders?.(res.headers);
    const text = res.status === 204 ? "" : await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };
}

/** One GET's state. */
export interface ApiResult<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  /** Ask again; settles once the answer is in. */
  reload: () => Promise<void>;
  /** Replace the data in place (after a write that returned the new record). */
  set: (data: T) => void;
}

export interface PagedResult<R> {
  rows: R[];
  page: PageMeta | undefined;
  loading: boolean;
  error: ApiError | null;
  pageNumber: number;
  setPage: (n: number) => void;
  /** Search text as typed; the request follows 250 ms later. */
  q: string;
  setQ: (q: string) => void;
  /**
   * The list's one sort key, as the server takes it: a field name with a
   * leading `-` for descending (F20). Undefined is the list's own default
   * order. Changing it goes back to page 1.
   */
  sort: string | undefined;
  setSort: (sort: string | undefined) => void;
  /** Ask for the current page again; settles once it is in. */
  reload: () => Promise<void>;
}

/** Runs `fn` while holding a lock every tab of this origin shares; in-tab only where the browser has no Web Locks. */
function acrossTabs<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request(name, fn) as Promise<T>) : fn();
}

export function createApi<E>(config: ApiConfig) {
  type K0 = Key<E>;
  let accessToken: string | null = null;
  let onSessionEnded: ((code: string) => void) | null = null;
  let onRefreshed: ((body: unknown) => void) | null = null;
  let endCode = "SESSION_ENDED";
  let refreshing: Promise<boolean> | null = null;
  let mockTransport: Transport | null = null;
  const network = config.transport ?? fetchTransport(config.credentials, config.onHeaders);

  async function transport(req: RawRequest): Promise<RawResponse> {
    if (config.mock) {
      if (!mockTransport) mockTransport = await config.mock();
      return mockTransport(req);
    }
    return network(req);
  }

  type Opts<K extends K0> = { query?: QueryOf<E, K>; body?: BodyOf<E, K>; params?: ParamsOf<E, K>; signal?: AbortSignal; idempotencyKey?: string };

  function build<K extends K0>(key: K, opts: Opts<K>): RawRequest {
    const space = key.indexOf(" ");
    const params = (opts.params ?? {}) as Record<string, string>;
    const path = key.slice(space + 1).replace(/:([a-z_]+)/g, (_, name: string) => {
      const v = params[name];
      if (v == null) throw new Error(`api.call(${key}): missing path param "${name}"`);
      return encodeURIComponent(v);
    });
    return {
      method: key.slice(0, space),
      path,
      query: (opts.query ?? {}) as Record<string, unknown>,
      body: opts.body,
      headers: {
        ...(config.auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      signal: opts.signal,
    };
  }

  /**
   * Try the refresh cookie once. Concurrent 401s in this tab share one refresh,
   * and other tabs wait their turn, so each presents the cookie the last one
   * rotated to. When it is refused, `session.endCode` says why (the server's
   * code: SESSION_TIME_LIMIT, SESSION_IDLE, SESSION_ENDED, or NETWORK).
   */
  function refreshSession(): Promise<boolean> {
    if (!config.auth) return Promise.resolve(false);
    const refreshPath = config.auth.refreshPath;
    if (!refreshing) {
      refreshing = acrossTabs(`refresh ${refreshPath}`, () => transport({ method: "POST", path: refreshPath, query: {}, body: {}, headers: {} }))
        .then((res) => {
          const token = (res.body as { access_token?: string } | null)?.access_token;
          accessToken = res.status === 200 && token ? token : null;
          if (accessToken) onRefreshed?.(res.body);
          else endCode = (res.body as ErrorBody | null)?.error?.code ?? "SESSION_ENDED";
          return accessToken !== null;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function call<K extends K0>(key: K, opts: Opts<K> = {}): Promise<ResponseOf<E, K>> {
    let res = await transport(build(key, opts));
    const isRefresh = !!config.auth && key.includes(config.auth.refreshPath.replace(/\/refresh$/, "/"));
    if (res.status === 401 && config.auth && !isRefresh) {
      if (await refreshSession()) res = await transport(build(key, opts));
      else if (endCode !== "NETWORK") onSessionEnded?.(endCode);
    }
    if (res.status >= 200 && res.status < 300) return res.body as ResponseOf<E, K>;
    throw new ApiError(res.status, res.body as ErrorBody | null);
  }

  const session = {
    setToken(token: string | null) {
      accessToken = token;
    },
    get token() {
      return accessToken;
    },
    /** Why the last refresh was refused. */
    get endCode() {
      return endCode;
    },
    /** The session ended: the refresh cookie was refused after a 401. Receives the server's code. */
    onEnded(fn: (code: string) => void) {
      onSessionEnded = fn;
    },
    /** A refresh succeeded; receives its body (the new token and the session's clock). */
    onRefreshed(fn: (body: unknown) => void) {
      onRefreshed = fn;
    },
  };

  /* ───── reads, with a small cache and invalidation by path ───── */

  /** A mounted read, asked to load again; `quiet` keeps what it shows. It may hand back when it has landed. */
  type Listener = (quiet: boolean) => Promise<void> | void;
  const cache = new Map<string, unknown>();
  const listeners = new Map<string, Set<Listener>>();
  const cacheKey = (key: string, params: unknown, query: unknown) => JSON.stringify([key, params ?? null, query ?? null]);
  const pathOf = (key: string, params: unknown) => {
    const p = (params ?? {}) as Record<string, string>;
    return key.slice(key.indexOf(" ") + 1).replace(/:([a-z_]+)/g, (_, n: string) => p[n] ?? "");
  };
  function subscribe(path: string, fn: Listener) {
    let set = listeners.get(path);
    if (!set) listeners.set(path, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** Asks every mounted read under the prefixes again and drops their cached answers; settles when the last has landed. */
  function reloadUnder(prefixes: string[], quiet: boolean): Promise<void> {
    const landed: Promise<void>[] = [];
    for (const [path, set] of listeners) {
      if (!prefixes.some((p) => path.startsWith(p))) continue;
      set.forEach((fn) => {
        const out = fn(quiet);
        if (out) landed.push(out);
      });
    }
    for (const k of [...cache.keys()]) {
      const path = JSON.parse(k)[0] as string;
      if (prefixes.some((p) => path.slice(path.indexOf(" ") + 1).startsWith(p))) cache.delete(k);
    }
    return Promise.allSettled(landed).then(() => undefined);
  }

  /** Refetch everything whose path starts with one of these prefixes: invalidate("/api/v1/employees"). */
  function invalidate(...prefixes: string[]) {
    void reloadUnder(prefixes, false);
  }

  /**
   * Refresh in place (FRONTEND_FOUNDATION F28): every mounted read under these
   * prefixes asks again quietly, its data staying on screen and `loading`
   * false, so nothing turns back into a skeleton. The promise settles once the
   * last of them has landed, whether it answered or failed.
   */
  function refresh(...prefixes: string[]): Promise<void> {
    return reloadUnder(prefixes, true);
  }

  /** One GET. Pass `enabled: false` to wait (a detail panel with no id yet). */
  function useApi<K extends K0>(key: K, opts: { params?: ParamsOf<E, K>; query?: QueryOf<E, K>; enabled?: boolean } = {}): ApiResult<ResponseOf<E, K>> {
    const { params, query, enabled = true } = opts;
    const ck = cacheKey(key, params, query);
    const cached = () => (config.cache ? (cache.get(ck) as ResponseOf<E, K> | undefined) : undefined);
    const [state, setState] = useState<{ ck: string; data?: ResponseOf<E, K>; error: ApiError | null; loading: boolean }>(() => ({
      ck,
      data: cached(),
      error: null,
      loading: enabled && !(config.cache && cache.has(ck)),
    }));
    const [tick, setTick] = useState(0);
    // Who waits for the next answer (refresh, a caller's reload), and whether it should keep what is shown.
    const waiting = useRef<Array<() => void>>([]);
    const quiet = useRef(false);
    const ask = useCallback(
      (soft: boolean) =>
        new Promise<void>((resolve) => {
          waiting.current.push(resolve);
          quiet.current = soft;
          setTick((t) => t + 1);
        }),
      [],
    );
    const reload = useCallback(() => ask(false), [ask]);

    useEffect(() => {
      const mine = waiting.current.splice(0);
      const settle = () => mine.forEach((done) => done());
      const soft = quiet.current;
      quiet.current = false;
      if (!enabled) {
        settle();
        return;
      }
      let live = true;
      setState((s) => ({ ck, data: s.ck === ck ? s.data : cached(), error: null, loading: !(soft && s.ck === ck && s.data !== undefined) }));
      const [k, p, q] = JSON.parse(ck) as [K, ParamsOf<E, K>, QueryOf<E, K>];
      call(k, { params: p ?? undefined, query: q ?? undefined } as Opts<K>)
        .then((data) => {
          if (config.cache) cache.set(ck, data);
          if (live) setState({ ck, data, error: null, loading: false });
        })
        .catch((e: unknown) => {
          const error = e instanceof ApiError ? e : new ApiError(0, null);
          if (live) setState((s) => ({ ck, data: s.data, error, loading: false }));
        })
        .finally(settle);
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `ck` is the serialised key, params and query
    }, [ck, enabled, tick]);

    useEffect(() => subscribe(pathOf(key, params), ask), [key, params, ask]);

    const set = useCallback(
      (data: ResponseOf<E, K>) => {
        if (config.cache) cache.set(ck, data);
        setState({ ck, data, error: null, loading: false });
      },
      [ck],
    );

    const fresh = state.ck === ck;
    return {
      data: fresh ? state.data : cached(),
      error: fresh ? state.error : null,
      loading: enabled && (fresh ? state.loading : true),
      reload,
      set,
    };
  }

  type PagedKey = PagedKeyOf<E>;
  type Filters<K extends K0> = Omit<NonNullable<QueryOf<E, K>>, "page" | "q" | "sort">;

  /** A server-paged list with search, filters and sort. Changing q, a filter or the sort goes back to page 1. */
  function usePaged<K extends PagedKey & K0>(
    key: K,
    opts: { params?: ParamsOf<E, K>; filters?: Filters<K>; sort?: SortOf<E, K>; enabled?: boolean } = {},
  ): PagedResult<RowOf<E, K>> {
    const [pageNumber, setPage] = useState(1);
    const [q, setQText] = useState("");
    const [qSent, setQSent] = useState("");
    // The list's starting order is the caller's; after that the person's choice wins.
    const [sort, setSortValue] = useState<string | undefined>(opts.sort as string | undefined);
    const filterKey = JSON.stringify(opts.filters ?? {});
    const lastFilters = useRef(filterKey);

    useEffect(() => {
      const t = setTimeout(() => {
        setQSent(q.trim());
        setPage(1);
      }, 250);
      return () => clearTimeout(t);
    }, [q]);

    useEffect(() => {
      if (lastFilters.current !== filterKey) {
        lastFilters.current = filterKey;
        setPage(1);
      }
    }, [filterKey]);

    const setSort = useCallback((next: string | undefined) => {
      setSortValue(next);
      setPage(1);
    }, []);

    const query = { ...(opts.filters ?? {}), page: pageNumber, ...(qSent ? { q: qSent } : {}), ...(sort ? { sort } : {}) } as QueryOf<E, K>;
    const res = useApi(key, { params: opts.params, query, enabled: opts.enabled });
    const body = res.data as { data: RowOf<E, K>[]; page: PageMeta } | undefined;
    return { rows: body?.data ?? [], page: body?.page, loading: res.loading, error: res.error, pageNumber, setPage, q, setQ: setQText, sort, setSort, reload: res.reload };
  }

  /** The same paged API for a phone: rows accumulate as the person scrolls, fetching page + 1 while has_next. */
  function useInfinite<K extends PagedKey & K0>(key: K, opts: { params?: ParamsOf<E, K>; filters?: Filters<K>; q?: string; enabled?: boolean } = {}) {
    const [pages, setPages] = useState<number>(1);
    const resetKey = JSON.stringify([key, opts.params ?? null, opts.filters ?? {}, opts.q ?? ""]);
    const [state, setState] = useState<{ reset: string; rows: RowOf<E, K>[]; page?: PageMeta; loading: boolean; error: ApiError | null }>({
      reset: resetKey,
      rows: [],
      loading: false,
      error: null,
    });

    useEffect(() => {
      setPages(1);
    }, [resetKey]);

    // invalidate() of this list, refresh(), or reload(): from the first page again. Each settles once that page is in;
    // refresh() keeps the rows on screen meanwhile (quiet).
    const [tick, setTick] = useState(0);
    const waiting = useRef<Array<() => void>>([]);
    const quiet = useRef(false);
    const ask = useCallback(
      (soft: boolean) =>
        new Promise<void>((resolve) => {
          waiting.current.push(resolve);
          quiet.current = soft;
          setPages(1);
          setTick((t) => t + 1);
        }),
      [],
    );
    const reload = useCallback(() => ask(false), [ask]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resetKey` is the serialised key and params
    useEffect(() => subscribe(pathOf(key, opts.params), ask), [key, resetKey, ask]);

    useEffect(() => {
      const soft = quiet.current;
      quiet.current = false;
      if (opts.enabled === false) {
        waiting.current.splice(0).forEach((done) => done());
        return;
      }
      let live = true;
      const settle = () => waiting.current.splice(0).forEach((done) => done());
      const [k, p, f, q] = JSON.parse(resetKey) as [K, ParamsOf<E, K>, Record<string, unknown>, string];
      setState((s) => ({ ...s, loading: !(soft && s.reset === resetKey && s.rows.length > 0) }));
      call(k, { params: p ?? undefined, query: { ...f, page: pages, ...(q ? { q } : {}) } } as Opts<K>)
        .then((body) => {
          const b = body as { data: RowOf<E, K>[]; page: PageMeta };
          if (!live) return;
          setState((s) => ({
            reset: resetKey,
            rows: pages === 1 || s.reset !== resetKey ? b.data : [...s.rows, ...b.data],
            page: b.page,
            loading: false,
            error: null,
          }));
          settle();
        })
        .catch((e: unknown) => {
          if (live) setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e : new ApiError(0, null) }));
          settle();
        });
      return () => {
        live = false;
      };
    }, [resetKey, pages, opts.enabled, tick]);

    const more = useCallback(() => {
      if (!state.loading && state.page?.has_next) setPages((n) => n + 1);
    }, [state.loading, state.page]);

    return { rows: state.reset === resetKey ? state.rows : [], page: state.page, loading: state.loading, error: state.error, more, reload };
  }

  /** A write. `fields` holds the server's per-field messages after a 422, for the marks on the form. */
  function useMutation<K extends K0>(key: K) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const run = useCallback(
      async (opts: { params?: ParamsOf<E, K>; body?: BodyOf<E, K>; query?: QueryOf<E, K>; idempotencyKey?: string } = {}) => {
        setPending(true);
        setError(null);
        try {
          return await call(key, opts as Opts<K>);
        } catch (e) {
          setError(e instanceof ApiError ? e : new ApiError(0, null));
          throw e;
        } finally {
          setPending(false);
        }
      },
      [key],
    );
    return { run, pending, error, fields: error?.fields ?? {}, reset: () => setError(null) };
  }

  return { api: { call }, session, refreshSession, invalidate, refresh, useApi, usePaged, useInfinite, useMutation };
}
