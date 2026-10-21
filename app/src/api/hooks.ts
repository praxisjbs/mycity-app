import { core } from "./client";

/**
 * Data hooks, bound to the staff app's client (the shared core lives in
 * @mycity/ui createApi). A small cache so returning to a screen shows the last
 * answer at once, and invalidation by path so a write refreshes every list that
 * shows what it changed. `refresh` is the quiet one, for the pull and the
 * refresh button (FRONTEND_FOUNDATION F28): what is shown stays until the new
 * answers land, and its promise settles when the last one has.
 *
 * Lists are ALWAYS the server's pages (FRONTEND_GUIDE §4): usePaged sends
 * `page`, `q`, one `sort` and the list's own filters, and shows `page.total`.
 * Nothing here filters, sorts or slices rows on the client.
 */
export const { useApi, usePaged, useInfinite, useMutation, invalidate, refresh } = core;
export type { PagedResult } from "@mycity/ui";
