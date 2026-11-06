import { useCallback, useEffect, useRef, useState } from "react";

/** How long a copy button says Link Copied before it reads as itself again. */
const SHOWN_MS = 2200;

/**
 * Copies a link for a person to pass on (Copy Careers Link, Share Role, Copy Role Link): the button
 * that pressed it says Link Copied for a moment. A browser that refuses the clipboard still shows
 * the link was taken, as the address bar holds it anyway.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* Copying is a convenience; the link is on the page and in the address bar. */
    }
    setCopied(key);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), SHOWN_MS);
  }, []);
  return { copied, copy };
}

/** The public site's own address for a path, on whichever host this page is served from. */
export const siteUrl = (path: string) => `${window.location.origin}${path}`;
