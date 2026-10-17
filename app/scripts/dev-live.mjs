/**
 * `npm run dev:live`: the dev server on the real API (localhost:3000), the way staging
 * runs: the in-browser mock is never loaded, and a screen opens only once its PROGRESS
 * row has API ticked (Coming Soon before that). The same as
 * `VITE_API_MODE=live npm run dev`, without setting the variable by hand on Windows.
 */
import { createServer } from "vite";

process.env.VITE_API_MODE = "live";
const server = await createServer();
await server.listen();
server.printUrls();
