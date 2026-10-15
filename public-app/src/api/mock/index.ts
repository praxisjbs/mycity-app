/** Entry of the public mock API. Imported only when VITE_API_MODE=mock (api/client.ts). */
import "./public";
import { dispatch } from "./core";

export const mockTransport = dispatch;
