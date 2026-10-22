import { uploadFile, type UploadOptions } from "@mycity/ui";
import { session } from "./client";
import type { DocumentRef } from "./types/common";

/**
 * How the staff app sends a file (gate 18, FRONTEND_GUIDE §8.7). The engine is
 * one copy in @mycity/ui (`uploadFile`); this adds what is the app's: the
 * bearer token from memory and the refresh cookie.
 *
 * In mock mode (a laptop build only) nothing travels: the progress is
 * simulated at the same pace and the document is registered with the mock, so
 * a later request that names it by id finds it.
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

/** How fast the simulated progress climbs, and how often, in milliseconds. */
const TICK = 110;

function pretend({ endpoint, file, onProgress }: UploadOptions): Promise<DocumentRef> {
  return new Promise((resolve) => {
    let percent = 0;
    const timer = setInterval(() => {
      percent = Math.min(100, percent + 8 + Math.round(Math.random() * 18));
      onProgress?.(percent);
      if (percent < 100) return;
      clearInterval(timer);
      const id = crypto.randomUUID();
      /* The mailbox's routes answer with an attachment id as well as the document. */
      const doc = {
        document_id: id,
        ...(endpoint.includes("/mailbox/") ? { attachment_id: id } : {}),
        /* A conversation's upload answers its MediaRef: the shape and sizes, none made on a laptop. */
        ...(endpoint.includes("/community/") ? { width: null, height: null, page_count: null, duration_ms: null, waveform: null, variants: [] } : {}),
        /* A dictation answers its transcript beside the recording kept (docs/guides/performance.md §6.17). */
        ...(endpoint.endsWith("/dictation") ? { transcript: "um two features move to november both are drafted and the venues are confirmed", ai_run_id: null } : {}),
        file_name: file.name,
        size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
      } as DocumentRef;
      void import("./mock/uploads").then((m) => {
        m.UPLOADS.set(id, doc);
        m.ON_UPLOAD.forEach((after) => after(endpoint, doc));
        resolve(doc);
      });
    }, TICK);
  });
}

/** Pass this to every `UploadField` in the staff app. */
export const upload = (options: UploadOptions): Promise<DocumentRef> =>
  MOCK
    ? pretend(options)
    : (uploadFile({
        ...options,
        credentials: true,
        headers: { ...options.headers, ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      }) as Promise<DocumentRef>);
