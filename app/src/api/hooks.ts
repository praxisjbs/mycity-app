import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";
import type { BodyOf, EndpointKey, PagedKey, ParamsOf, QueryOf, ResponseOf, RowOf } from "./endpoints";
import type { PageMeta } from "./types/common";

/**
 * Data hooks over api.call. Small by design: a cache so returning to a screen
 * shows the last answer at once, and invalidation by path so a write refreshes
 * every list that shows what it changed.
 *
 * Lists are ALWAYS the server's pages (FRONTEND_GUIDE §4): usePaged sends `page`,
 * `q` and the list's own filters, and shows `page.total`. Nothing here filters,
 * sorts or slices rows on the client.
 */
type Listener = () => void;
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

/**
 * Refetch everything whose path starts with one of these prefixes:
 * invalidate("/api/v1/employees") after an employee is saved.
 */
export function invalidate(...prefixes: string[]) {
  for (const [path, set] of listeners) {
    if (prefixes.some((p) => path.startsWith(p))) set.forEach((fn) => fn());
  }
  for (const k of [...cache.keys()]) {
    const path = JSON.parse(k)[0] as string;
    if (prefixes.some((p) => path.slice(path.indexOf(" ") + 1).startsWith(p))) cache.delete(k);
  }
}

interface Result<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** One GET. Pass `enabled: false` to wait (a detail panel with no id yet). */
export function useApi<K extends EndpointKey>(
  key: K,
  opts: { params?: ParamsOf<K>; query?: QueryOf<K>; enabled?: boolean } = {},
): Result<ResponseOf<K>> {
  const { params, query, enabled = true } = opts;
  const ck = cacheKey(key, params, query);
  const [state, setState] = useState<{ ck: string; data?: ResponseOf<K>; error: ApiError | null; loading: boolean }>(() => ({
    ck,
    data: cache.get(ck) as ResponseOf<K> | undefined,
    error: null,
    loading: enabled && !cache.has(ck),
  }));
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => ({ ck, data: s.ck === ck ? s.data : (cache.get(ck) as ResponseOf<K> | undefined), error: null, loading: true }));
    const [k, p, q] = JSON.parse(ck) as [K, ParamsOf<K>, QueryOf<K>];
    api
      .call(k, { params: p ?? undefined, query: q ?? undefined })
      .then((data) => {
        cache.set(ck, data);
        if (live) setState({ ck, data, error: null, loading: false });
      })
      .catch((error: ApiError) => {
        if (live) setState((s) => ({ ck, data: s.data, error, loading: false }));
      });
    return () => {
      live = false;
    };
  }, [ck, enabled, tick]);

  useEffect(() => subscribe(pathOf(key, params), reload), [key, params, reload]);

  const fresh = state.ck === ck;
  return {
    data: fresh ? state.data : (cache.get(ck) as ResponseOf<K> | undefined),
    error: fresh ? state.error : null,
    loading: enabled && (fresh ? state.loading : true),
    reload,
  };
}

type Filters<K extends PagedKey> = Omit<NonNullable<QueryOf<K>>, "page" | "q">;

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
  reload: () => void;
}

/** A server-paged list with search and filters. Changing q or a filter goes back to page 1. */
export function usePaged<K extends PagedKey>(
  key: K,
  opts: { params?: ParamsOf<K>; filters?: Filters<K>; enabled?: boolean } = {},
): PagedResult<RowOf<K>> {
  const [pageNumber, setPage] = useState(1);
  const [q, setQText] = useState("");
  const [qSent, setQSent] = useState("");
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

  const query = { ...(opts.filters ?? {}), page: pageNumber, ...(qSent ? { q: qSent } : {}) } as QueryOf<K>;
  const res = useApi(key, { params: opts.params, query, enabled: opts.enabled });
  const body = res.data as { data: RowOf<K>[]; page: PageMeta } | undefined;
  return {
    rows: body?.data ?? [],
    page: body?.page,
    loading: res.loading,
    error: res.error,
    pageNumber,
    setPage,
    q,
    setQ: setQText,
    reload: res.reload,
  };
}

/**
 * The same paged API for a phone: rows accumulate as the person scrolls,
 * fetching `page + 1` while `has_next` (FRONTEND_GUIDE §4).
 */
export function useInfinite<K extends PagedKey>(
  key: K,
  opts: { params?: ParamsOf<K>; filters?: Filters<K>; q?: string; enabled?: boolean } = {},
) {
  const [pages, setPages] = useState<number>(1);
  const resetKey = JSON.stringify([key, opts.params ?? null, opts.filters ?? {}, opts.q ?? ""]);
  const [state, setState] = useState<{ reset: string; rows: RowOf<K>[]; page?: PageMeta; loading: boolean; error: ApiError | null }>({
    reset: resetKey,
    rows: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    setPages(1);
  }, [resetKey]);

  useEffect(() => {
    if (opts.enabled === false) return;
    let live = true;
    const [k, p, f, q] = JSON.parse(resetKey) as [K, ParamsOf<K>, Record<string, unknown>, string];
    setState((s) => ({ ...s, loading: true }));
    api
      .call(k, { params: p ?? undefined, query: { ...f, page: pages, ...(q ? { q } : {}) } as QueryOf<K> })
      .then((body) => {
        const b = body as { data: RowOf<K>[]; page: PageMeta };
        if (!live) return;
        setState((s) => ({
          reset: resetKey,
          rows: pages === 1 || s.reset !== resetKey ? b.data : [...s.rows, ...b.data],
          page: b.page,
          loading: false,
          error: null,
        }));
      })
      .catch((error: ApiError) => live && setState((s) => ({ ...s, loading: false, error })));
    return () => {
      live = false;
    };
  }, [resetKey, pages, opts.enabled]);

  const more = useCallback(() => {
    if (!state.loading && state.page?.has_next) setPages((n) => n + 1);
  }, [state.loading, state.page]);

  return { rows: state.reset === resetKey ? state.rows : [], page: state.page, loading: state.loading, error: state.error, more };
}

/** A write. `fields` holds the server's per-field messages after a 422, for the marks on the form. */
export function useMutation<K extends EndpointKey>(key: K) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(
    async (opts: { params?: ParamsOf<K>; body?: BodyOf<K>; query?: QueryOf<K> } = {}) => {
      setPending(true);
      setError(null);
      try {
        return await api.call(key, opts);
      } catch (e) {
        setError(e as ApiError);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [key],
  );
  return { run, pending, error, fields: error?.fields ?? {}, reset: () => setError(null) };
}
