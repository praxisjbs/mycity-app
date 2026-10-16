/**
 * The Data group: the one API client core and its hooks, shared by both apps
 * (FRONTEND_GUIDE §9.5), and the shared list that draws a server page
 * (DataView, F20) with its pager, toolbar and Export.
 *
 * Each app binds the client once in src/api/client.ts and src/api/hooks.ts;
 * screens import the hooks from those files and the components from here.
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
  type SortOf,
  type RawRequest,
  type RawResponse,
  type Transport,
} from "./createApi";
export { DataView, LoadingRows, type DataViewProps, type DataViewColumn, type DataViewList, type DataViewSelection, type LoadingRowsProps } from "./DataView";
export { Pager, type PagerProps } from "./Pager";
export { Toolbar, type ToolbarProps } from "./Toolbar";
export { ExportButton, type ExportButtonProps } from "./ExportButton";
