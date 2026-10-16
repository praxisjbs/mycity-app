import { uploadFile, type UploadOptions } from "@mycity/ui";
import type { DocumentRef } from "./types/common";

/**
 * How the public site sends a file (gate 18). The engine is one copy in
 * @mycity/ui; there is no session here, so nothing is added to the request: a
 * candidate's CV travels on the strength of the link's own token, which is in
 * the route.
 *
 * In mock mode (a laptop build only) nothing travels and the progress is
 * simulated at the same pace.
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

/** How fast the simulated progress climbs, and how often, in milliseconds. */
const TICK = 110;

function pretend({ file, onProgress }: UploadOptions): Promise<DocumentRef> {
  return new Promise((resolve) => {
    let percent = 0;
    const timer = setInterval(() => {
      percent = Math.min(100, percent + 9 + Math.round(Math.random() * 16));
      onProgress?.(percent);
      if (percent < 100) return;
      clearInterval(timer);
      resolve({
        document_id: crypto.randomUUID(),
        file_name: file.name,
        size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
      });
    }, TICK);
  });
}

/** Pass this to every `UploadField` on the public site. */
export const upload = (options: UploadOptions): Promise<DocumentRef> => (MOCK ? pretend(options) : (uploadFile(options) as Promise<DocumentRef>));
