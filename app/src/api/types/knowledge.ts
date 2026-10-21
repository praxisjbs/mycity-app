import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status } from "./shared";

/** INTERIM Knowledge Hub and Praxis AI shapes (owner AJ; MILESTONES §14, §15). */
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
export interface Faq {
  faq_id: Uuid;
  question: string;
  answer: string | null;
  topic: string;
}
export interface FaqsSummary {
  questions: number;
  asked_this_month: number;
  most_asked: string;
  unanswered: number;
  from_ai: number;
  topics: Array<{ topic: string; count: number }>;
}
export interface Resource {
  resource_id: Uuid;
  title: string;
  description: string;
  kind: "Video" | "Document" | "Course";
  due: IsoDate | null;
  assigned: number;
  completed: number;
}
export interface TrainingSummary {
  resources: number;
  completion_pct: number;
  overdue: number;
  certificates: number;
}
export interface Overdue {
  key: string;
  person: PersonRef;
  resource: string;
  due: IsoDate;
}

export interface AiAnswer {
  turn_id: Uuid;
  question: string;
  text: string;
  table: { columns: string[]; rows: string[][]; numeric: number[] } | null;
  note: string | null;
  sources: Array<{ label: string; count: number }>;
  /** Praxis AI never writes. It can offer the screen where a person does. */
  action: { label: string; link: string } | null;
  declined: boolean;
}
export interface AiTurn {
  turn_id: Uuid;
  question: string;
  asked_at: IsoDateTime;
  sources: string;
  tokens: number;
  cost: Money;
}
export interface AiSummary {
  questions_this_month: number;
  yours: number;
  spend: Money;
  cap: Money;
  trend: { labels: string[]; values: Money[] };
  topics: BarRow[];
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/knowledge/articles/summary": { query: { kind: ArticleKind }; body: never; params: never; response: ArticlesSummary };
    "GET /api/v1/knowledge/articles": { query: Q<{ kind: ArticleKind }>; body: never; params: never; response: Paged<ArticleRow> };
    "GET /api/v1/knowledge/articles/:id": { query: never; body: never; params: { id: string }; response: Article };
    "POST /api/v1/knowledge/articles": { query: never; body: { kind: ArticleKind; title: string; group: string; blocks: Block[] }; params: never; response: Article };
    "GET /api/v1/knowledge/faqs/summary": { query: never; body: never; params: never; response: FaqsSummary };
    "GET /api/v1/knowledge/faqs": { query: Q<{ topic?: string }>; body: never; params: never; response: Paged<Faq> };
    "POST /api/v1/knowledge/faqs": { query: never; body: { question: string; answer: string; topic: string }; params: never; response: Faq };
    "GET /api/v1/knowledge/training/summary": { query: never; body: never; params: never; response: TrainingSummary };
    "GET /api/v1/knowledge/training": { query: Q; body: never; params: never; response: Paged<Resource> };
    "GET /api/v1/knowledge/training/overdue": { query: Q; body: never; params: never; response: Paged<Overdue> };
    "POST /api/v1/knowledge/training": { query: never; body: { title: string; description: string; kind: Resource["kind"]; due?: IsoDate; audience: "everyone" | "department"; department?: string }; params: never; response: Resource };
    "POST /api/v1/knowledge/training/overdue/remind": { query: never; body: Record<string, never>; params: never; response: { reminded: number } };
    "GET /api/v1/ai/suggestions": { query: never; body: never; params: never; response: string[] };
    "POST /api/v1/ai/ask": { query: never; body: { question: string }; params: never; response: AiAnswer };
    "GET /api/v1/ai/history/summary": { query: never; body: never; params: never; response: AiSummary };
    "GET /api/v1/ai/history": { query: Q; body: never; params: never; response: Paged<AiTurn> };
    "DELETE /api/v1/ai/history": { query: never; body: never; params: never; response: null };
  }
}
