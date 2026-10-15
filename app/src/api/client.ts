import { createApi } from "@mycity/ui";
import { noteEnvironmentHeader } from "@/lib/environment";
import type { Endpoints } from "./endpoints";

/**
 * The staff app's binding of the one API client (@mycity/ui createApi;
 * FRONTEND_GUIDE §3, §9.5).
 *
 *   api.call("GET /api/v1/employees", { query: { page: 2, q: "ada" } })
 *   api.call("PATCH /api/v1/employees/:id", { params: { id }, body })
 *
 * Auth is the backend's: a 15-minute access token held in memory, and a
 * refresh cookie (HttpOnly, host-only) the browser sends to /auth/refresh. On a
 * 401 the client refreshes once and retries; if that fails the session ends.
 *
 * VITE_API_MODE=mock (a laptop build only) answers from the in-browser mock
 * API. The mock module is imported only in that mode, so a release build does
 * not carry it (F12, check/mock-free.js).
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

export const core = createApi<Endpoints>({
  auth: { refreshPath: "/api/v1/auth/refresh" },
  credentials: "include",
  cache: true,
  mock: MOCK ? () => import("./mock").then((m) => m.mockTransport) : undefined,
  onHeaders: (headers) => noteEnvironmentHeader(headers.get("X-Mycity-Environment")),
});

export const api = core.api;
export const session = core.session;
export const refreshSession = core.refreshSession;
export { ApiError, type RawRequest, type RawResponse } from "@mycity/ui";
