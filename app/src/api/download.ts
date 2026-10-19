import { useCallback, useEffect, useState } from "react";
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
 *   const photo = usePhotos(rows.map((r) => r.employee.photo_url));  // people's faces
 *   <Who name={r.employee.display_name} src={photo(r.employee.photo_url)} />
 *
 * In mock mode (a laptop build only) nothing travels and the screen says so,
 * because the in-browser mock holds no bytes.
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

const FAILED = "That file could not be opened. Try again.";

/** A gated file's bytes, fetched with the session's token (the map's tiles use it too). */
export async function fetchBlob(url: string): Promise<Blob> {
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

/*
 * People's photos (`photo_url` on PersonRef and the other person shapes): the same faces appear
 * on many screens, so each is fetched once with the session and kept by its URL, shared by every
 * screen that shows it. A photo nobody shows is released a few minutes later, and every one is
 * released at sign-out. A photo that fails stays failed until it is released, so a broken face is
 * not asked for again on every row: the initials show instead.
 */
const PHOTO_RELEASE_MS = 5 * 60_000;

interface Photo {
  href: string | null;
  users: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const PHOTOS = new Map<string, Photo>();

function releasePhoto(url: string, photo: Photo): void {
  if (photo.users > 0 || PHOTOS.get(url) !== photo) return;
  if (photo.href) URL.revokeObjectURL(photo.href);
  PHOTOS.delete(url);
}

/** Start using a photo; the returned function stops. `changed` runs when its blob is ready. */
function acquirePhoto(url: string, changed: () => void): () => void {
  let photo = PHOTOS.get(url);
  if (!photo) {
    const made: Photo = { href: null, users: 0, listeners: new Set(), timer: null };
    PHOTOS.set(url, made);
    fetchBlob(url)
      .then((blob) => {
        if (PHOTOS.get(url) !== made) return;
        made.href = URL.createObjectURL(blob);
        made.listeners.forEach((fn) => fn());
      })
      .catch(() => undefined);
    photo = made;
  }
  const held = photo;
  if (held.timer) {
    clearTimeout(held.timer);
    held.timer = null;
  }
  held.users += 1;
  held.listeners.add(changed);
  return () => {
    held.users -= 1;
    held.listeners.delete(changed);
    if (held.users === 0) held.timer = setTimeout(() => releasePhoto(url, held), PHOTO_RELEASE_MS);
  };
}

/** Release every photo: the session ended, and the next person must not see the last one's cache. */
export function clearPhotos(): void {
  PHOTOS.forEach((photo) => {
    if (photo.timer) clearTimeout(photo.timer);
    if (photo.href) URL.revokeObjectURL(photo.href);
  });
  PHOTOS.clear();
}

/**
 * Photos for a list of people: pass every `photo_url` the screen shows (nulls are fine), and
 * read each one back through the returned function, which gives a blob URL for Avatar's or
 * Who's `src`, or null while it loads, when it failed, when there is none, and in mock mode.
 */
export function usePhotos(urls: ReadonlyArray<string | null | undefined>): (url: string | null | undefined) => string | null {
  const [ready, setReady] = useState<Record<string, string>>({});
  const key = [...new Set(urls.filter((u): u is string => typeof u === "string" && u !== ""))].sort().join("\n");
  useEffect(() => {
    if (!key || MOCK) return;
    const wanted = key.split("\n");
    const changed = () => {
      const pairs = wanted.map((url) => [url, PHOTOS.get(url)?.href] as const);
      setReady(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => typeof p[1] === "string")));
    };
    const stops = wanted.map((url) => acquirePhoto(url, changed));
    return () => stops.forEach((stop) => stop());
  }, [key]);
  // A face already fetched by another screen shows at once; one still loading arrives through `ready`.
  return useCallback(
    (url: string | null | undefined) => (url && !MOCK ? (ready[url] ?? PHOTOS.get(url)?.href ?? null) : null),
    [ready],
  );
}

/** One person's photo, from the same cache as usePhotos. */
export function usePhoto(url: string | null | undefined): string | null {
  return usePhotos([url])(url);
}
