/**
 * The Data group: the one API client core and its hooks, shared by both apps (FRONTEND_GUIDE §9.5).
 * Each app binds it once in src/api/client.ts and src/api/hooks.ts; screens import from those.
 */
export {
  createApi,
  ApiError,
  type ApiConfig,
  type ApiResult,
  type PagedResult,
  type PageMeta,
  type ErrorBody,
  type EndpointShape,
  type QueryOf,
  type BodyOf,
  type ParamsOf,
  type ResponseOf,
  type PagedKeyOf,
  type RowOf,
  type RawRequest,
  type RawResponse,
  type Transport,
} from "./createApi";
