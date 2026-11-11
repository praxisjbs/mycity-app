import type { IsoDate, Paged, PersonRef, Uuid } from "./common";

/**
 * INTERIM Knowledge Hub · Training shapes until the training screens move onto the contract
 * (docs/guides/knowledge.md Appendix A, PR 5). SOPs are on the contract (`knowledge.js`); Praxis AI
 * is too (assistant).
 */
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

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/knowledge/training/summary": { query: never; body: never; params: never; response: TrainingSummary };
    "GET /api/v1/knowledge/training": { query: Q; body: never; params: never; response: Paged<Resource> };
    "GET /api/v1/knowledge/training/overdue": { query: Q; body: never; params: never; response: Paged<Overdue> };
    "POST /api/v1/knowledge/training": { query: never; body: { title: string; description: string; kind: Resource["kind"]; due?: IsoDate; audience: "everyone" | "department"; department?: string }; params: never; response: Resource };
    "POST /api/v1/knowledge/training/overdue/remind": { query: never; body: Record<string, never>; params: never; response: { reminded: number } };
  }
}
