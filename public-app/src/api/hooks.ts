import { core } from "./client";

/**
 * Data hooks, bound to the public site's client (the shared core lives in
 * @mycity/ui createApi). A page holds few reads, so nothing is cached.
 * Lists are the server's pages (FRONTEND_GUIDE §4): the page and the search go
 * to the server; the page size is the server's and is never sent.
 */
export const { useApi, usePaged } = core;
