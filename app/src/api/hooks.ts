import { core } from "./client";

/**
 * Data hooks, bound to the staff app's client (the shared core lives in
 * @mycity/ui createApi). A small cache so returning to a screen shows the last
 * answer at once, and invalidation by path so a write refreshes every list that
 * shows what it changed.
 *
 * Lists are ALWAYS the server's pages (FRONTEND_GUIDE §4): usePaged sends
 * `page`, `q`, one `sort` and the list's own filters, and shows `page.total`.
 * Nothing here filters, sorts or slices rows on the client.
 */
export const { useApi, usePaged, useInfinite, useMutation, invalidate } = core;
export type { PagedResult } from "@mycity/ui";
