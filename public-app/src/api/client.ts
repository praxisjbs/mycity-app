import { createApi, noteEnvironmentHeader } from "@mycity/ui";
import type { Endpoints } from "./endpoints";

/**
 * The public site's binding of the one API client (@mycity/ui createApi):
 * /api/public/v1 only, no session, no cookie, no auth header (A9). A person
 * reaches a page by an opaque token in its address, or by slug for careers.
 *
 * VITE_API_MODE=mock (a laptop build only) answers from the in-browser mock; a
 * release build does not carry it (F12, check/mock-free.js).
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

export const core = createApi<Endpoints>({
  credentials: "omit",
  mock: MOCK ? () => import("./mock").then((m) => m.mockTransport) : undefined,
  onHeaders: (headers) => noteEnvironmentHeader(headers.get("X-Mycity-Environment")),
});

export const api = core.api;
export { ApiError, type RawRequest, type RawResponse } from "@mycity/ui";
