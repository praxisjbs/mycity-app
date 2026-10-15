import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./client";
import type { EndpointKey, PagedKey, ParamsOf, QueryOf, ResponseOf, RowOf } from "./endpoints";
import type { PageMeta } from "./types/common";

type Result<T> = { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => void; set: (d: T) => void };

/** One GET, refetched when its params change. A page holds few reads, so there is no cache. */
export function useApi<K extends EndpointKey>(key: K, opts: { params?: ParamsOf<K>; query?: QueryOf<K>; enabled?: boolean } = {}): Result<ResponseOf<K>> {
  const { params, query, enabled = true } = opts;
  const dep = JSON.stringify([key, params, query, enabled]);
  const [state, setState] = useState<{ dep: string; data?: ResponseOf<K>; error: ApiError | null; loading: boolean }>({ dep, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  if (state.dep !== dep) setState({ dep, error: null, loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .call(key, { params, query } as never)
      .then((data) => live && setState({ dep, data, error: null, loading: false }))
      .catch((e: unknown) => live && setState({ dep, error: e instanceof ApiError ? e : new ApiError(0, null), loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dep` is the serialised key, params and query
  }, [dep, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((data: ResponseOf<K>) => setState((s) => ({ ...s, data, error: null, loading: false })), []);
  return { data: state.data, error: state.error, loading: state.loading, reload, set };
}

/**
 * A server-paged list (FRONTEND_GUIDE §4): the page and the search go to the
 * server; the page size is the server's and is never sent.
 */
export function usePaged<K extends PagedKey>(key: K) {
  const [page, setPage] = useState(1);
  const [q, setQState] = useState("");
  const r = useApi(key, { query: { page, ...(q.trim() ? { q: q.trim() } : {}) } as QueryOf<K> });
  const data = r.data as { data: RowOf<K>[]; page: PageMeta } | undefined;
  const setQ = useCallback((v: string) => {
    setQState(v);
    setPage(1);
  }, []);
  return { rows: data?.data ?? [], page: data?.page ?? null, loading: r.loading, error: r.error, q, setQ, setPage, reload: r.reload };
}
