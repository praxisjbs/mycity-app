/**
 * @component AddressField
 * @group Forms
 * @summary An address typed with suggestions from our own address search; picking one fills the address and hands back its coordinates.
 * @use Any address in a form: a worksite, a field site, a client visit, a home. Pass `onPick` where the place's latitude and longitude fill the form's own fields.
 * @avoid Calling the provider from the browser (the key stays on the server); a search box that only finds (PlaceSearch); the browser's own autofill list or a `<datalist>` (gate 21).
 * @phone 44 px tall with 16 px text; the suggestions open under the field as 44 px rows, inside the sheet's own scroll.
 * @a11y A combobox over a listbox of addresses: arrows move through them, Enter picks, Esc closes; the count found is announced. Takes its label and error links from the Field around it.
 * @status stable
 * @example <AddressField {...f.field("address")} search={searchPlaces} onPick={(p) => { f.set("latitude", String(p.lat)); f.set("longitude", String(p.lon)); }} />
 */
import { useId, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import type { Place, SearchPlaces } from "../maps/geoapify";
import { usePlaces } from "../maps/usePlaces";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type" | "role" | "autoComplete">;

export interface AddressFieldProps extends NativeInput {
  /** The address, from form.field(name): what was typed, or the place picked. */
  value: string;
  /** Called with the new address as the person types or picks. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** Finds addresses; the app's own call through our proxy. */
  search: SearchPlaces;
  /** Called with the place picked, its coordinates included, after the address is set. */
  onPick?: (place: Place) => void;
}

export function AddressField({ value, onChange, onBlur, state, message: _message, search, onPick, className, id, ...rest }: AddressFieldProps) {
  const a = useFieldControl({ id, state });
  const listId = `${useId().replace(/[^A-Za-z0-9_-]/g, "")}-places`;
  // Only what the person typed is searched: an address set by a pick or by the record is not.
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { places, looking, problem, asked } = usePlaces(search, open && typed !== null ? typed : "");
  const listed = open && places.length > 0;

  const pick = (place: Place) => {
    onChange(place.formatted);
    onPick?.(place);
    setTyped(null);
    setOpen(false);
    setActive(-1);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!places.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + places.length) % places.length);
    } else if (e.key === "Enter" && listed && active >= 0) {
      e.preventDefault();
      pick(places[active]!);
    } else if (e.key === "Escape" && listed) {
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={className}>
      <span className="relative flex items-center">
        <input
          {...rest}
          {...a}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
          className={cn(controlClass(a.state), "h-control", (a.state || (open && looking)) && "pr-9")}
          value={value ?? ""}
          onChange={(e) => {
            onChange(e.target.value);
            setTyped(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={keys}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            onBlur?.();
          }}
        />
        {open && looking ? (
          <Spinner size="s" label="Looking" className="pointer-events-none absolute right-3" />
        ) : a.state === "bad" ? (
          <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />
        ) : a.state === "good" ? (
          <Icon name="ok" size="s" className="pointer-events-none absolute right-3 text-success" />
        ) : null}
      </span>
      {listed && (
        <>
          <p aria-live="polite" className="sr-only">{`${places.length} addresses found`}</p>
          <div id={listId} role="listbox" aria-label="Addresses" className="mt-1 max-h-56 overflow-y-auto rounded-box border border-border bg-popover">
            {places.map((place, i) => (
              <button
                key={place.place_id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // The field keeps focus while a row is pressed, so the list is still there for the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(place)}
                className={cn(
                  "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted phone:min-h-tap",
                  i === active && "bg-muted",
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
      {open && problem && (
        <p role="status" className="px-3 pt-1 text-2xs text-destructive">
          Could not search addresses
        </p>
      )}
      {open && asked && !looking && !problem && places.length === 0 && <p className="px-3 pt-1 text-2xs text-subtle-foreground">No address matches</p>}
    </div>
  );
}
