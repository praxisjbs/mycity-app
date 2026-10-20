import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError, createApi, type RawRequest, type RawResponse } from "./createApi";

interface Row {
  employee_id: string;
}
interface Endpoints {
  "GET /api/v1/employees": { query: { page?: number; q?: string; status?: string }; body: never; params: never; response: { data: Row[]; page: { number: number; size: number; total: number; pages: number; has_next: boolean } } };
  "POST /api/v1/employees": { query: never; body: { first_name: string }; params: never; response: Row };
  "GET /api/v1/employees/:id": { query: never; body: never; params: { id: string }; response: Row };
}

const page = (n: number, total = 60) => ({ data: [{ employee_id: `e${n}` }], page: { number: n, size: 25, total, pages: 3, has_next: n < 3 } });

function fake(handler: (req: RawRequest) => RawResponse) {
  const seen: RawRequest[] = [];
  const transport = vi.fn(async (req: RawRequest) => {
    seen.push(req);
    return handler(req);
  });
  return { transport, seen };
}

describe("createApi", () => {
  it("fills path params and refuses a missing one", async () => {
    const { transport, seen } = fake(() => ({ status: 200, body: { employee_id: "e1" } }));
    const core = createApi<Endpoints>({ credentials: "omit", transport });
    await core.api.call("GET /api/v1/employees/:id", { params: { id: "a b" } });
    expect(seen[0]!.path).toBe("/api/v1/employees/a%20b");
    await expect(core.api.call("GET /api/v1/employees/:id", { params: {} as { id: string } })).rejects.toThrow(/missing path param/);
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    let calls = 0;
    const { transport, seen } = fake((req) => {
      if (req.path.endsWith("/auth/refresh")) return { status: 200, body: { access_token: "t2" } };
      calls += 1;
      return calls === 1 ? { status: 401, body: null } : { status: 200, body: { employee_id: "e1" } };
    });
    const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", transport });
    core.session.setToken("t1");
    await core.api.call("GET /api/v1/employees/:id", { params: { id: "e1" } });
    expect(seen.map((r) => r.path)).toEqual(["/api/v1/employees/e1", "/api/v1/auth/refresh", "/api/v1/employees/e1"]);
    expect(seen[2]!.headers.Authorization).toBe("Bearer t2");
  });

  it("ends the session when the refresh fails", async () => {
    const { transport } = fake((req) => (req.path.endsWith("/refresh") ? { status: 401, body: null } : { status: 401, body: null }));
    const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", transport });
    const ended = vi.fn();
    core.session.onEnded(ended);
    await expect(core.api.call("GET /api/v1/employees/:id", { params: { id: "e1" } })).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith("SESSION_ENDED");
  });

  it("says why the session ended, and hands a good refresh's clock to the app", async () => {
    let refuse = false;
    const { transport } = fake((req) => {
      if (req.path.endsWith("/refresh"))
        return refuse ? { status: 401, body: { error: { code: "SESSION_IDLE", message: "Idle" } } } : { status: 200, body: { access_token: "t2", session_expires_in: 600 } };
      return { status: 401, body: null };
    });
    const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", transport });
    const ended = vi.fn();
    const refreshed = vi.fn();
    core.session.onEnded(ended);
    core.session.onRefreshed(refreshed);
    expect(await core.refreshSession()).toBe(true);
    expect(refreshed).toHaveBeenCalledWith({ access_token: "t2", session_expires_in: 600 });
    refuse = true;
    await core.api.call("GET /api/v1/employees/:id", { params: { id: "e1" } }).catch(() => undefined);
    expect(ended).toHaveBeenCalledWith("SESSION_IDLE");
    expect(core.session.endCode).toBe("SESSION_IDLE");
  });

  it("does not end the session when the refresh could not reach the server", async () => {
    const { transport } = fake((req) => (req.path.endsWith("/refresh") ? { status: 0, body: { error: { code: "NETWORK", message: "Offline" } } } : { status: 401, body: null }));
    const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", transport });
    const ended = vi.fn();
    core.session.onEnded(ended);
    await core.api.call("GET /api/v1/employees/:id", { params: { id: "e1" } }).catch(() => undefined);
    expect(ended).not.toHaveBeenCalled();
  });

  it("takes refreshes one at a time across tabs through a shared lock", async () => {
    const held: string[] = [];
    const request = vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      held.push(name);
      return fn();
    });
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    try {
      const { transport } = fake(() => ({ status: 200, body: { access_token: "t2" } }));
      const core = createApi<Endpoints>({ auth: { refreshPath: "/api/v1/auth/refresh" }, credentials: "include", transport });
      await Promise.all([core.refreshSession(), core.refreshSession()]);
      expect(held).toEqual(["refresh /api/v1/auth/refresh"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends an idempotency key and puts a 422's fields on the error", async () => {
    const { transport, seen } = fake(() => ({ status: 422, body: { error: { code: "VALIDATION", message: "Check the form", fields: { first_name: ["Required"] } }, request_id: "r1" } }));
    const core = createApi<Endpoints>({ credentials: "omit", transport });
    const { result } = renderHook(() => core.useMutation("POST /api/v1/employees"));
    await act(async () => {
      await result.current.run({ body: { first_name: "" }, idempotencyKey: "k1" }).catch(() => undefined);
    });
    expect(seen[0]!.headers["Idempotency-Key"]).toBe("k1");
    expect(result.current.fields).toEqual({ first_name: ["Required"] });
    expect(result.current.error?.requestId).toBe("r1");
  });

  it("usePaged sends page and q, never a page size, and shows the true total", async () => {
    const { transport, seen } = fake((req) => ({ status: 200, body: page(Number(req.query.page)) }));
    const core = createApi<Endpoints>({ credentials: "omit", transport, cache: true });
    const { result } = renderHook(() => core.usePaged("GET /api/v1/employees", { filters: { status: "active" } }));
    await waitFor(() => expect(result.current.page?.total).toBe(60));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page?.number).toBe(2));
    for (const r of seen) expect(Object.keys(r.query).sort()).toEqual(["page", "status"]);
    act(() => result.current.setQ("ada"));
    await waitFor(() => expect(seen.at(-1)!.query).toEqual({ status: "active", page: 1, q: "ada" }));
  });

  it("invalidate refetches every mounted read under a path", async () => {
    const { transport, seen } = fake(() => ({ status: 200, body: page(1) }));
    const core = createApi<Endpoints>({ credentials: "omit", transport, cache: true });
    renderHook(() => core.useApi("GET /api/v1/employees", { query: { page: 1 } }));
    await waitFor(() => expect(seen).toHaveLength(1));
    act(() => core.invalidate("/api/v1/employees"));
    await waitFor(() => expect(seen).toHaveLength(2));
  });

  it("refresh asks every mounted read again quietly and settles when the last has landed", async () => {
    let n = 0;
    const answers: Array<() => void> = [];
    const transport = vi.fn(
      (req: RawRequest) =>
        new Promise<RawResponse>((resolve) => {
          const k = (n += 1);
          const body = req.path.endsWith("/e1") ? { employee_id: `one-${k}` } : page(1, 60 + k);
          if (k <= 2) resolve({ status: 200, body });
          else answers.push(() => resolve({ status: 200, body }));
        }),
    );
    const core = createApi<Endpoints>({ credentials: "omit", transport, cache: true });
    const list = renderHook(() => core.useApi("GET /api/v1/employees", { query: { page: 1 } }));
    const one = renderHook(() => core.useApi("GET /api/v1/employees/:id", { params: { id: "e1" } }));
    await waitFor(() => expect(list.result.current.data?.page.total).toBe(61));
    await waitFor(() => expect(one.result.current.data?.employee_id).toBe("one-2"));

    let settled = false;
    let done!: Promise<void>;
    act(() => {
      done = core.refresh("/api/").then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(answers).toHaveLength(2));
    // While it asks, the screen keeps what it shows and nothing says it is loading.
    expect(list.result.current.loading).toBe(false);
    expect(list.result.current.data?.page.total).toBe(61);
    expect(one.result.current.loading).toBe(false);

    await act(async () => answers[0]!());
    expect(settled).toBe(false);
    await act(async () => {
      answers[1]!();
      await done;
    });
    expect(settled).toBe(true);
    expect([list.result.current.data?.page.total, one.result.current.data?.employee_id].sort()).toEqual([63, "one-4"].sort());
  });

  it("refresh settles at once with nothing mounted, and a reload still says it is loading", async () => {
    const { transport, seen } = fake(() => ({ status: 200, body: page(1) }));
    const core = createApi<Endpoints>({ credentials: "omit", transport, cache: true });
    await expect(core.refresh("/api/")).resolves.toBeUndefined();
    const { result } = renderHook(() => core.useApi("GET /api/v1/employees", { query: { page: 1 } }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    let reloading!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    await act(async () => reloading);
    expect(result.current.loading).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("refresh keeps a phone list's rows while its first page comes again", async () => {
    let total = 60;
    const { transport, seen } = fake((req) => ({ status: 200, body: page(Number(req.query.page), total) }));
    const core = createApi<Endpoints>({ credentials: "omit", transport, cache: true });
    const { result } = renderHook(() => core.useInfinite("GET /api/v1/employees"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    total = 61;
    let done!: Promise<void>;
    act(() => {
      done = core.refresh("/api/v1/employees");
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(2);
    await act(async () => done);
    expect(result.current.page?.total).toBe(61);
    expect(result.current.rows).toHaveLength(1);
    expect(seen.at(-1)!.query.page).toBe(1);
  });
});
