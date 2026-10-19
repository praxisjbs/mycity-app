import { useEffect, useState } from "react";
import { toast } from "@mycity/ui";
import { session } from "./client";

/**
 * Reading a file back out of the vault, the mirror of api/upload.ts.
 *
 * Every file route is gated (`GET /api/v1/documents/:id/content`, an import's
 * error file), and the session's access token lives in memory, not in a cookie
 * the browser would attach by itself. So a plain `<a href>` or an `<img src>`
 * to one of those paths is a 401. Both helpers here fetch the bytes with the
 * token and hand the browser a blob instead:
 *
 *   await saveFile("/api/v1/imports/x/report", "IMP-0001.xlsx");   // a download
 *   const url = useFileUrl(doc ? `/api/v1/documents/${doc.id}/content` : null);
 *
 * In mock mode (a laptop build only) nothing travels and the screen says so,
 * because the in-browser mock holds no bytes.
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

const FAILED = "That file could not be opened. Try again.";

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, {
    credentials: "include",
    headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) throw new Error(FAILED);
  return res.blob();
}

/** Fetch a gated file and save it under `filename`. */
export async function saveFile(url: string, filename: string): Promise<void> {
  if (MOCK) {
    toast("Files download once the API is connected");
    return;
  }
  try {
    const href = URL.createObjectURL(await fetchBlob(url));
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    toast(FAILED);
  }
}

/**
 * A blob URL for a gated file, for a preview that draws it (DocumentPreview,
 * an <img>). Null while it is being fetched, in mock mode, or when there is
 * nothing to show. The URL is released when it changes and when the screen goes.
 */
export function useFileUrl(url: string | null): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!url || MOCK) {
      setHref(null);
      return;
    }
    let live = true;
    let made: string | null = null;
    fetchBlob(url)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setHref(made);
      })
      .catch(() => live && setHref(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setHref(null);
    };
  }, [url]);
  return href;
}

/**
 * Blob URLs for several gated files at once, by key: a mail body's inline parts,
 * keyed by content id. A part that fails is simply missing, and draws nothing.
 * Every URL is released when the set changes and when the screen goes.
 */
export function useFileUrls(urls: Record<string, string>): Record<string, string> {
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  const key = JSON.stringify(urls);
  useEffect(() => {
    const wanted = Object.entries(JSON.parse(key) as Record<string, string>);
    if (!wanted.length || MOCK) {
      setHrefs({});
      return;
    }
    let live = true;
    const made: string[] = [];
    void Promise.all(
      wanted.map(([k, url]) =>
        fetchBlob(url)
          .then((blob) => {
            const href = URL.createObjectURL(blob);
            made.push(href);
            return [k, href] as const;
          })
          .catch(() => null),
      ),
    ).then((pairs) => {
      if (live) setHrefs(Object.fromEntries(pairs.filter((p) => p !== null)));
    });
    return () => {
      live = false;
      made.forEach((h) => URL.revokeObjectURL(h));
      setHrefs({});
    };
  }, [key]);
  return hrefs;
}
