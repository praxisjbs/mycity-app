/**
 * The endpoint map the client is typed against: "METHOD /path" → its shapes.
 *
 * The generated contract (packages/contract/contract.gen.ts) exports the same
 * shape as `Endpoints`. Until it covers every module, each module's interim
 * types file adds its routes here by declaration merging:
 *
 *   declare module "@/api/endpoints" {
 *     interface Endpoints {
 *       "GET /api/v1/employees": { query: EmployeeListQuery; body: never; params: never; response: Paged<EmployeeRow> };
 *     }
 *   }
 *
 * A wrong path, a wrong field or a wrong response shape is then a type error.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Endpoints {}

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
