/**
 * @component PlaceSearch
 * @group Maps
 * @summary Finds an address through our own API and hands back the place with its coordinates.
 * @use Setting up a worksite, giving a partner an address, naming where a field visit happened.
 * @avoid Calling the provider from the browser (the key must stay on the server); a free-text address box where a point is needed; a list of every result.
 * @phone Full width, each result a 44 px row; the chosen address shows above the box.
 * @a11y A search box over a listbox of addresses, each a real option, with the count of what was found announced.
 * @status stable
 * @example <PlaceSearch search={api.searchPlaces} onPick={(place) => form.set("point", place)} />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import { SearchInput } from "../form/SearchInput";
import type { Place, SearchPlaces } from "./geoapify";

/** Characters before the first request: fewer finds the whole of Lagos. */
const FROM = 3;

/** How long after the last key the request goes, in milliseconds. */
const SETTLE = 300;

export interface PlaceSearchProps {
  /** Finds addresses; the app's own call through our proxy. */
  search: SearchPlaces;
  /** Called with the address chosen. */
  onPick: (place: Place) => void;
  /** The address already chosen, shown above the box. */
  value?: Place | null;
  /** A format example of at most 3 words; "Search address" otherwise. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function PlaceSearch({ search, onPick, value, placeholder = "Search address", className }: PlaceSearchProps) {
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < FROM) {
      setPlaces([]);
      setLooking(false);
      return;
    }
    setLooking(true);
    setProblem(false);
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      search(text)
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
  }, [q, search]);

  return (
    <div className={className}>
      {value && (
        <p className="mb-2 flex items-start gap-1.5 text-xs">
          <Icon name="pin" size="s" className="mt-0.5 flex-none text-secondary" />
          <span data-copy="content">{value.formatted}</span>
        </p>
      )}
      <SearchInput value={q} onChange={setQ} placeholder={placeholder} label={placeholder} />
      {looking && (
        <p className="flex items-center gap-2 px-3 py-2 text-2xs text-subtle-foreground">
          <Spinner size="s" />
          Looking
        </p>
      )}
      {problem && (
        <p role="status" className="px-3 py-2 text-2xs text-destructive">
          Could not search addresses
        </p>
      )}
      {places.length > 0 && (
        <>
          <p aria-live="polite" className="sr-only">{`${places.length} addresses found`}</p>
          <div role="listbox" aria-label={placeholder} className="mt-2 max-h-56 overflow-y-auto rounded-box border border-border">
            {places.map((place) => (
              <button
                key={place.place_id}
                type="button"
                role="option"
                aria-selected={value?.place_id === place.place_id}
                onClick={() => {
                  onPick(place);
                  setQ("");
                  setPlaces([]);
                }}
                className={cn(
                  "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted phone:min-h-tap",
                  value?.place_id === place.place_id && "bg-accent",
                )}
              >
                <Icon name="pin" size="s" className="mt-0.5 flex-none text-subtle-foreground" />
                <span data-copy="content" className="min-w-0 wrap-any">
                  {place.formatted}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {!looking && !problem && q.trim().length >= FROM && places.length === 0 && (
        <p className="px-3 py-2 text-2xs text-subtle-foreground">No address matches</p>
      )}
    </div>
  );
}
