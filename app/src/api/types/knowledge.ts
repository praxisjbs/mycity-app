import type { IsoDate, Paged, Uuid } from "./common";
import type { Status } from "./performance";

/** INTERIM Knowledge Hub shapes (owner AJ; MILESTONES §14). Praxis AI is on the contract (assistant). */
export type ArticleKind = "policy" | "sop";
/** Article text as blocks; `**word**` marks bold. Never HTML from the server. */
export type Block = { type: "h" | "p" | "quote"; text: string } | { type: "ul"; items: string[] };
export interface ArticleRow {
  article_id: Uuid;
  kind: ArticleKind;
  title: string;
  group: string;
  status: Status;
  version: number;
  updated_on: IsoDate;
  owner: string;
  read_minutes: number;
}
export interface Article extends ArticleRow {
  blocks: Block[];
}
export interface ArticlesSummary {
  current: number;
  archived: number;
  groups: number;
  read_this_month: number;
  average_minutes: number;
  owner: string;
  last_updated: IsoDate | null;
  first_id: Uuid | null;
}
type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/knowledge/articles/summary": { query: { kind: ArticleKind }; body: never; params: never; response: ArticlesSummary };
    "GET /api/v1/knowledge/articles": { query: Q<{ kind: ArticleKind }>; body: never; params: never; response: Paged<ArticleRow> };
    "GET /api/v1/knowledge/articles/:id": { query: never; body: never; params: { id: string }; response: Article };
    "POST /api/v1/knowledge/articles": { query: never; body: { kind: ArticleKind; title: string; group: string; blocks: Block[] }; params: never; response: Article };
  }
}
