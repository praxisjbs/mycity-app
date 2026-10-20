/**
 * @component PlacesField
 * @group Forms
 * @summary Several places picked from our own address search, each a chip with Remove: a proposal's cities.
 * @use A list of cities (the default level) or areas a record covers, where each must be a real place (F27, gate 22).
 * @avoid One address (AddressField); city names typed into a TextField (gate 22); a short fixed list of options (ChoiceField, SelectField).
 * @phone The chips wrap above the field, each Remove a 44 px target; the suggestions open under the field as 44 px rows.
 * @a11y A combobox over a listbox: arrows move, Enter adds, Esc closes; each chip's Remove names its place; the count found and an outage are announced. Takes its label and error links from the Field around it.
 * @status stable
 * @example <PlacesField {...f.field("cities")} places={places} />
 */
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import { Button } from "../actions/Button";
import type { Place, PlaceLevel, Places, PlaceValue } from "../maps/geoapify";
import { usePlaces } from "../maps/usePlaces";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";
import { KIND_ICON } from "./AddressField";

export interface PlacesFieldProps {
  /** The places picked, from form.field(name): each a token our search signed. */
  value: PlaceValue[];
  /** Called with the new list, a place added or removed. */
  onChange: (value: PlaceValue[]) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** The form field's name, on the search box. */
  name?: string;
  /** The control's id; the Field around it supplies one otherwise. */
  id?: string;
  /** The app's address search and token reader, bound once (`features/shared/places.ts`). */
  places: Places;
  /** What each pick may be: a city (the default), or anything to a city (`area`). */
  level?: Exclude<PlaceLevel, "address">;
  /** How many may be picked; the box goes once that many are. */
  max?: number;
  /** A format example of at most 3 words. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function PlacesField({ value, onChange, onBlur, state, message: _message, name, id, places, level = "city", max = 12, placeholder = "Abuja", className }: PlacesFieldProps) {
  const a = useFieldControl({ id, state });
  const listId = `${useId().replace(/[^A-Za-z0-9_-]/g, "")}-places`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const picked = value ?? [];
  const lines = picked.map((p) => (p.token ? places.read(p.token)?.formatted : null) ?? "Unknown place");
  const full = picked.length >= max;

  const results = usePlaces(places.search, full ? "" : text, { level });
  // A place already picked is not offered again.
  const found = results.places.filter((p) => !picked.some((v) => v.token === p.token) && !lines.includes(p.formatted));
  const listed = open && found.length > 0;
  const nothing = open && results.answered && found.length === 0 && !results.down;

  const add = (place: Place) => {
    if (!place.token) return;
    onChange([...picked, { token: place.token }]);
    setText("");
    setActive(-1);
  };
  const remove = (i: number) => onChange(picked.filter((_, j) => j !== i));

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = found.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      // Enter adds, or does nothing: what was typed is never a place.
      if (listed && active >= 0) {
        e.preventDefault();
        add(found[active]!);
      } else if (text.trim()) e.preventDefault();
    } else if (e.key === "Escape" && (listed || nothing)) {
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Backspace" && !text && picked.length) {
      remove(picked.length - 1);
    }
  };

  /** Leaving the field: what was typed and not added goes. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setOpen(false);
    setActive(-1);
    setText("");
    onBlur?.();
  };

  return (
    <div className={className} onBlur={leave}>
      {picked.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
          {picked.map((p, i) => (
            <li key={p.token ?? i} className="inline-flex items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2.5 text-xs">
              <span data-copy="content">{lines[i]}</span>
              <button
                type="button"
                aria-label={`Remove ${lines[i]}`}
                onClick={() => remove(i)}
                className="flex size-5 items-center justify-center rounded-full hover:bg-card phone:size-tap"
              >
                <Icon name="x" size="s" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <span className="relative flex items-center">
          <input
            {...a}
            name={name}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={listed}
            aria-controls={listed ? listId : undefined}
            aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
            className={cn(controlClass(a.state), "h-control", (a.state === "bad" || results.looking) && "pr-9")}
            placeholder={placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={keys}
          />
          {results.looking ? (
            <Spinner size="s" label="Searching" className="pointer-events-none absolute right-3" />
          ) : a.state === "bad" ? (
            <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />
          ) : null}
        </span>
      )}
      {listed && (
        <>
          <p aria-live="polite" className="sr-only">{`${found.length} places found`}</p>
          <div id={listId} role="listbox" aria-label="Places" className="mt-1 max-h-64 overflow-y-auto rounded-box border border-border bg-popover">
            {found.map((place, i) => (
              <button
                key={place.place_id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // The field keeps focus while a row is pressed, so the list is still there for the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(place)}
                className={cn(
                  "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted phone:min-h-tap",
                  i === active && "bg-muted",
                )}
              >
                <Icon name={KIND_ICON[place.kind ?? "unknown"]} size="s" className="mt-0.5 flex-none text-subtle-foreground" />
                <span data-copy="content" className="min-w-0 wrap-any">
                  {place.formatted}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {nothing && <p className="px-3 pt-2 text-xs font-semibold">No place found</p>}
      {results.down && (
        <div className="mt-2 flex flex-col gap-2 rounded-box border border-border bg-muted px-3 py-2.5 desk:flex-row desk:items-center desk:justify-between">
          <p role="status" className="flex items-center gap-1.5 text-xs font-semibold">
            <Icon name="offline" size="s" />
            Address search is unavailable
          </p>
          <Button size="sm" icon="refresh" onClick={results.retry}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
