import type { Endpoints as Contract } from "@mycity/contract/contract.gen.ts";

/**
 * The endpoint map the client is typed against: "METHOD /path" → its shapes.
 *
 * It starts from the generated contract (packages/contract/contract.gen.ts,
 * F15): every route the API mounts, its request parts as the API accepts them
 * and its response as the API sends it. A module whose routes are not built yet
 * adds its INTERIM routes here by declaration merging, from its types file:
 *
 *   declare module "@/api/endpoints" {
 *     interface Endpoints {
 *       "GET /api/v1/employees": { query: EmployeeListQuery; body: never; params: never; response: Paged<EmployeeRow> };
 *     }
 *   }
 *
 * An INTERIM key that the contract also declares is a type error: when a
 * module's routes land, its INTERIM entries go (npm run contract:status).
 * A wrong path, a wrong field or a wrong response shape is a type error too.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Endpoints extends Contract {}

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
