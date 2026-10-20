/**
 * The address search the place components share (PlaceSearch, AddressField): it asks
 * only once enough is typed and the person has paused, and drops an answer to a search
 * they have already typed past, so a slow reply never replaces a newer one.
 */
import { useEffect, useRef, useState } from "react";
import type { Place, SearchPlaces } from "./geoapify";

/** Characters before the first request: fewer finds the whole of Lagos. */
export const SEARCH_FROM = 3;

/** How long after the last key the request goes, in milliseconds. */
const SETTLE = 300;

/** Where one search stands. */
export interface PlaceResults {
  /** What was found for the text, empty until it answers. */
  places: Place[];
  /** A request is waiting or on its way. */
  looking: boolean;
  /** The last request failed. */
  problem: boolean;
  /** The text is long enough to have been searched. */
  asked: boolean;
}

/** Searches `text` through the app's own call; an empty text searches nothing. */
export function usePlaces(search: SearchPlaces, text: string): PlaceResults {
  const [places, setPlaces] = useState<Place[]>([]);
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState(false);
  const latest = useRef(0);
  const q = text.trim();
  const asked = q.length >= SEARCH_FROM;

  useEffect(() => {
    const mine = ++latest.current;
    if (!asked) {
      setPlaces([]);
      setLooking(false);
      setProblem(false);
      return;
    }
    setLooking(true);
    setProblem(false);
    const timer = setTimeout(() => {
      search(q)
        .then((found) => {
          // An answer to a search the person has already typed past is dropped.
          if (mine !== latest.current) return;
          setPlaces(found);
          setLooking(false);
        })
        .catch(() => {
          if (mine !== latest.current) return;
          setProblem(true);
          setPlaces([]);
          setLooking(false);
        });
    }, SETTLE);
    return () => clearTimeout(timer);
  }, [q, asked, search]);

  return { places, looking, problem, asked };
}
