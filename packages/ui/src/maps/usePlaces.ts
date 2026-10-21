/**
 * The address search the place components share (AddressField, PlacesField, PlaceSearch),
 * built to answer as the person types (docs/guides/addresses.md §6.4):
 *
 *   - it asks from the second character, 100 ms after the last key;
 *   - every answer is kept for the session (200 texts, all fields), so a text asked before
 *     is answered at once with no request;
 *   - while a request is on its way, the places held for an earlier, shorter text that
 *     still match every word typed show at once, and the list on screen stays until the
 *     answer replaces it, so it never flickers empty;
 *   - a newer key cancels the request it overtakes, and an answer to a text already typed
 *     past is dropped;
 *   - a failed answer (busy, or the provider not answering) is asked once more after 400 ms,
 *     so one blip never shows; a second failure means address search is down, and the field
 *     stops asking until Try Again (retry).
 */
import { useCallback, useEffect, useState } from "react";
import type { Place, PlaceLevel, SearchPlaces } from "./geoapify";

/** Characters before the first request. */
export const SEARCH_FROM = 2;

/** How long after the last key the request goes, in milliseconds. */
export const SETTLE_MS = 100;

/** How long a failed answer waits before it is asked once more. */
export const RETRY_MS = 400;

/** Texts kept for the session, across every field. */
const KEEP = 200;

const held = new Map<string, Place[]>();
const keyOf = (level: PlaceLevel, q: string) => `${level}|${q}`;

function keep(key: string, places: Place[]) {
  held.delete(key);
  held.set(key, places);
  if (held.size > KEEP) held.delete(held.keys().next().value as string);
}

/** Tests: forget every answer kept. */
export function forgetPlaces() {
  held.clear();
}

/** A text as the server compares it: trimmed, single spaces, lower case. */
export const normalise = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Lower case without accents, so "Ikoyi" matches "ikóyi". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The places held for the longest earlier text this one extends, that still match every word typed. */
function heldFor(level: PlaceLevel, q: string): Place[] | undefined {
  const words = fold(q).split(/[\s,]+/).filter(Boolean);
  for (let n = q.length - 1; n >= SEARCH_FROM; n -= 1) {
    const earlier = held.get(keyOf(level, q.slice(0, n).trimEnd()));
    if (!earlier) continue;
    return earlier.filter((p) => {
      const line = fold(p.formatted);
      return words.every((w) => line.includes(w));
    });
  }
  return undefined;
}

/** Where one search stands. */
export interface PlaceResults {
  /** What to show now: the answer for the text, or, while it comes, the places held that match it. */
  places: Place[];
  /** A request is waiting or on its way. */
  looking: boolean;
  /** The server answered this very text; an empty list then means nothing was found. */
  answered: boolean;
  /** Address search is unavailable: no key, the provider failing or silent, or busy twice. */
  down: boolean;
  /** The text is long enough to search. */
  asked: boolean;
  /** Ask again after an outage (Try Again). */
  retry: () => void;
}

interface Shown {
  places: Place[];
  looking: boolean;
  answered: boolean;
}

/** Searches `text` at a level through the app's own call; a text shorter than SEARCH_FROM searches nothing. */
export function usePlaces(search: SearchPlaces, text: string, { level = "address" }: { level?: PlaceLevel } = {}): PlaceResults {
  const q = normalise(text);
  const asked = q.length >= SEARCH_FROM;
  const [shown, setShown] = useState<Shown>({ places: [], looking: false, answered: false });
  const [down, setDown] = useState(false);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => {
    setDown(false);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!asked) {
      setShown({ places: [], looking: false, answered: false });
      return;
    }
    const key = keyOf(level, q);
    const exact = held.get(key);
    if (exact) {
      keep(key, exact);
      setShown({ places: exact, looking: false, answered: true });
      return;
    }
    const preview = heldFor(level, q);
    setShown((s) => ({ places: preview ?? s.places, looking: !down, answered: false }));
    if (down) return;

    const ctl = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    const ask = (retried: boolean): Promise<void> =>
      search(q, { level, signal: ctl.signal }).then(
        (found) => {
          if (ctl.signal.aborted) return;
          keep(key, found);
          setShown({ places: found, looking: false, answered: true });
        },
        () => {
          if (ctl.signal.aborted) return;
          if (!retried) {
            again = setTimeout(() => void ask(true), RETRY_MS);
            return;
          }
          setDown(true);
          setShown({ places: preview ?? [], looking: false, answered: false });
        },
      );
    const timer = setTimeout(() => void ask(false), SETTLE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(again);
      ctl.abort();
    };
  }, [q, level, asked, search, tick, down]);

  return { ...shown, looking: shown.looking && asked, down, asked, retry };
}
