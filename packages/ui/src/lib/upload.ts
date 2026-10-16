/**
 * The upload engine's transport, one copy for both apps (gate 18,
 * FRONTEND_GUIDE §8.7). `fetch` cannot report how far a request body has
 * travelled, and a 12 MB phone photograph on a Lagos connection must never
 * look like a frozen screen, so this is XMLHttpRequest for the percentage.
 *
 * It knows nothing about a session: each app wraps it in its own api client,
 * which adds the bearer token on the staff app and nothing on the public site.
 * The answer is the vault's document, and a record stores its `document_id`.
 */

/** A file in the vault, as every upload route answers. */
export interface DocumentRef {
  /** What a record stores (CLAUDE.md: files go through the vault, never a path). */
  document_id: string;
  /** The mailbox's routes answer with an attachment id as well. */
  attachment_id?: string;
  /** The name the person's file had. */
  file_name: string;
  /** Its size, for the tray's line. */
  size_bytes: number;
  /** What it is, as the server decided, not as the browser guessed. */
  mime_type: string;
}

export interface UploadOptions {
  /** Where the multipart goes (`/api/v1/documents`); the caller's own path. */
  endpoint: string;
  /** The file itself. */
  file: File;
  /** Other multipart fields the route takes (`purpose`, which decides the MIME policy server side). */
  fields?: Record<string, string>;
  /** Headers the app's client adds (the bearer token on the staff app). */
  headers?: Record<string, string>;
  /** Send the refresh cookie too (the staff app). */
  credentials?: boolean;
  /** Called with 0 to 100 as the file travels. */
  onProgress?: (percent: number) => void;
  /** Stops the upload (the person removed the file, or left the screen). */
  signal?: AbortSignal;
}

/** The one line a person reads when an upload does not finish. */
const FAILED = "Upload failed. Try again.";

/**
 * Send one file and report its progress. Resolves with the vault document, or
 * rejects with one short line a field can show.
 */
export function uploadFile({ endpoint, file, fields, headers, credentials, onProgress, signal }: UploadOptions): Promise<DocumentRef> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Upload stopped"));

    const request = new XMLHttpRequest();
    const body = new FormData();
    for (const [key, value] of Object.entries(fields ?? {})) body.append(key, value);
    body.append("file", file);

    request.open("POST", endpoint);
    if (credentials) request.withCredentials = true;
    for (const [key, value] of Object.entries(headers ?? {})) request.setRequestHeader(key, value);

    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    request.onload = () => {
      type Answer = { document_id?: string; error?: { message?: string } };
      let answer: Answer | null;
      try {
        answer = JSON.parse(request.responseText) as Answer;
      } catch {
        return reject(new Error(FAILED));
      }
      if (request.status >= 200 && request.status < 300 && answer?.document_id) resolve(answer as unknown as DocumentRef);
      else reject(new Error(answer?.error?.message ?? FAILED));
    };
    request.onerror = () => reject(new Error("You appear to be offline. Try again."));
    request.onabort = () => reject(new Error("Upload stopped"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(body);
  });
}

/** How a file is sent, so a screen can pass a different one (a test, the in-browser mock). */
export type Uploader = (options: UploadOptions) => Promise<DocumentRef>;
