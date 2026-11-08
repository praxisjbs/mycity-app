import type { Endpoints as Contract } from "@mycity/contract/contract.gen.ts";

/**
 * The endpoint map the client is typed against: "METHOD /path" → its shapes.
 *
 * M4's routes come from the generated contract (packages/contract/contract.gen.ts, F15), picked
 * by name so the public client can only reach the public surface: Careers, a Vacancy, Apply and
 * an Assessment, and M7's Proposal, with their request parts as the API accepts them and their responses as it sends
 * them, and the index's figures (`/jobs/summary`). A page whose routes are not in the contract yet (M5's Sign Offer and Verify) adds its
 * INTERIM routes here by declaration merging, from `types/public.ts`:
 *
 *   declare module "@/api/endpoints" {
 *     interface Endpoints {
 *       "GET /api/public/v1/sign/:token": { query: never; body: never; params: { token: string }; response: OfferToSign };
 *     }
 *   }
 *
 * A wrong path, a wrong field or a wrong response shape is then a type error.
 */
type ContractRoute =
  | "GET /api/public/v1/jobs"
  | "GET /api/public/v1/jobs/summary"
  | "GET /api/public/v1/jobs/:slug"
  | "POST /api/public/v1/jobs/:slug/apply"
  | "GET /api/public/v1/apply/:token"
  | "POST /api/public/v1/apply/:token/cv"
  | "POST /api/public/v1/apply/:token"
  | "GET /api/public/v1/assess/:token"
  | "POST /api/public/v1/assess/:token/start"
  | "PUT /api/public/v1/assess/:token/answers/:question_id"
  | "POST /api/public/v1/assess/:token/answers/:question_id/file"
  | "POST /api/public/v1/assess/:token/submit"
  | "GET /api/public/v1/proposals/:token"
  | "GET /api/public/v1/proposals/:token/pdf";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Endpoints extends Pick<Contract, ContractRoute> {}

export interface EndpointShape {
  query: unknown;
  body: unknown;
  params: unknown;
  response: unknown;
}

export type EndpointKey = keyof Endpoints & string;
type Shape<K extends EndpointKey> = Endpoints[K] extends EndpointShape ? Endpoints[K] : never;
export type QueryOf<K extends EndpointKey> = Shape<K>["query"];
export type BodyOf<K extends EndpointKey> = Shape<K>["body"];
export type ParamsOf<K extends EndpointKey> = Shape<K>["params"];
export type ResponseOf<K extends EndpointKey> = Shape<K>["response"];

/** Keys whose response is a page envelope. */
export type PagedKey = {
  [K in EndpointKey]: ResponseOf<K> extends { data: unknown[]; page: unknown } ? K : never;
}[EndpointKey];
export type RowOf<K extends PagedKey> = ResponseOf<K> extends { data: Array<infer R> } ? R : never;
