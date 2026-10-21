/**
 * @component AddressField
 * @group Forms
 * @summary An address picked, never typed: suggestions from our own address search as the person types, a pin on the map, and the device's location while search is down.
 * @use Every address or location a person enters, on both apps (F27, gate 22): a worksite, a field site, a client visit, a home, the company's address; `level="area"` for a vacancy's location or a partner's headquarters. `onPick` hands back the point where the form keeps its own.
 * @avoid A TextField for an address (gate 22); calling the provider from the browser (the key stays on the server); several cities (PlacesField); a search that keeps nothing (PlaceSearch).
 * @phone 44 px tall with 16 px text; the suggestions open under the field as 44 px rows inside the sheet's own scroll; the pin's map and its buttons fill the width.
 * @a11y A combobox over a listbox: arrows move, Enter picks, Esc closes; the count found and an outage are announced. A held address is read out with its Change button, which the field's label names. Takes its label and error links from the Field around it.
 * @status stable
 * @example <AddressField {...f.field("address")} places={places} onPick={(p) => f.set("latitude", p.lat.toFixed(6))} />
 * @example <AddressField {...f.field("location")} places={places} level="area" />
 */
import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Spinner } from "../display/Skeleton";
import { Pill } from "../display/Pill";
import { Button, IconButton } from "../actions/Button";
import { HelpTerm } from "../help/HelpTerm";
import { MapView } from "../maps/MapView";
import { describePoint, LAGOS, type DevicePoint, type LatLon, type Place, type PlaceKind, type PlaceLevel, type Places, type PlaceValue } from "../maps/geoapify";
import { RETRY_MS, usePlaces } from "../maps/usePlaces";
import type { FieldState } from "./binding";
import { Field, useFieldControl, useFieldLabelId, useFieldOptional } from "./Field";
import { TextField, controlClass } from "./TextField";

/** The glyph beside a place, by what it is. */
export const KIND_ICON: Record<PlaceKind, IconName> = {
  building: "building",
  street: "street",
  landmark: "landmark",
  area: "map",
  city: "globe",
  region: "globe",
  country: "globe",
  unknown: "pin",
};

/** Past this many metres a device's reading is approximate. */
const ROUGH_M = 200;

/** How long the device has to give a reading. */
const LOCATE_MS = 15_000;

/** The help on a location waiting for its name. */
const NAMED_LATER = "Named once address search is back.";

/** A reading from the device, or the device's refusal. */
function locate(): Promise<DevicePoint> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      reject(new Error("No location on this device"));
      return;
    }
    geo.getCurrentPosition(
      (p) =>
        resolve({
          lat: Number(p.coords.latitude.toFixed(6)),
          lon: Number(p.coords.longitude.toFixed(6)),
          accuracy_m: Math.min(100_000, Math.max(0, Math.round(p.coords.accuracy))),
        }),
      reject,
      { enableHighAccuracy: true, timeout: LOCATE_MS, maximumAge: 0 },
    );
  });
}

/** A failure that means address search is down, rather than this one request being wrong. */
function isOutage(err: unknown) {
  const status = err && typeof err === "object" && "status" in err ? Number((err as { status: unknown }).status) : 0;
  return status === 0 || status === 429 || status >= 500;
}

/** What the field holds, as it shows it. */
type Held =
  | { kind: "place"; line: string; icon: IconName; typed: boolean; point: LatLon | null }
  | { kind: "device"; accuracy: number; point: LatLon }
  | { kind: "waiting"; point: LatLon };

function heldOf(value: PlaceValue | null | undefined, read: Places["read"]): Held | null {
  if (!value) return null;
  if (value.device) return { kind: "device", accuracy: value.device.accuracy_m, point: { lat: value.device.lat, lon: value.device.lon } };
  if (!value.token) return null;
  const s = read(value.token);
  if (!s) return null;
  const point = s.lat !== null && s.lon !== null ? { lat: s.lat, lon: s.lon } : null;
  if (s.formatted === null || s.pending) return point ? { kind: "waiting", point } : null;
  return { kind: "place", line: s.formatted, icon: KIND_ICON[s.kind] ?? "pin", typed: s.source === "typed", point };
}

/** Drop a Pin: where the map opened, the point tapped, and the address the pin was given. */
interface Pinning {
  centre: LatLon;
  at: LatLon | null;
  found: Place | null;
  naming: boolean;
}

export interface AddressFieldProps {
  /** The address, from form.field(name): a pick's token, the device's location in an outage, and the details. */
  value: PlaceValue | null | undefined;
  /** Called with the new address: a pick, a pin, the device's location, new details, or null when cleared. */
  onChange: (value: PlaceValue | null) => void;
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
  /** The app's address search, pin and token reader, bound once (`features/shared/places.ts`). */
  places: Places;
  /** What a pick may be: a door (`address`, the default, with a Details line), anything to a city (`area`), a city. */
  level?: PlaceLevel;
  /** Called with the place picked or pinned, its point included, after the address is set. */
  onPick?: (place: Place) => void;
  /** Where the pin's map opens when the field holds no place: the form's own point. */
  near?: LatLon | null;
  /** A format example of at most 3 words. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function AddressField({
  value,
  onChange,
  onBlur,
  state,
  message: _message,
  name,
  id,
  places,
  level = "address",
  onPick,
  near,
  placeholder = "7 Admiralty Way",
  className,
}: AddressFieldProps) {
  const a = useFieldControl({ id, state });
  const labelId = useFieldLabelId();
  const optional = useFieldOptional();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const listId = `${uid}-places`;
  // A held address is read by the field's label (which names the control by this id) and Change.
  const lineId = a.id ?? `${uid}-line`;
  const changeId = `${uid}-change`;

  const read = places.read;
  const held = useMemo(() => heldOf(value, read), [value, read]);
  const [changing, setChanging] = useState(false);
  const searching = !held || changing;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pin, setPin] = useState<Pinning | null>(null);
  const [pinDown, setPinDown] = useState(false);
  const [noLocation, setNoLocation] = useState<"blocked" | "missing" | null>(null);
  const pinSeq = useRef(0);

  const results = usePlaces(places.search, searching && !pin ? text : "", { level });
  const down = results.down || pinDown;
  const found = results.places;
  const listed = searching && open && found.length > 0;
  const nothing = searching && open && results.answered && found.length === 0 && !down;

  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"input" | "change" | null>(null);
  useEffect(() => {
    if (focusNext.current === "input") input.current?.focus();
    else if (focusNext.current === "change") change.current?.focus();
    focusNext.current = null;
  });

  /** A pick, a pin or the device's location becomes the address; the details stay. */
  const choose = (next: PlaceValue, place?: Place) => {
    onChange({ ...next, details: value?.details ?? null });
    if (place) onPick?.(place);
    setChanging(false);
    setText("");
    setOpen(false);
    setActive(-1);
    setPin(null);
    setNoLocation(null);
    focusNext.current = "change";
  };
  const pick = (place: Place) => {
    if (place.token) choose({ token: place.token }, place);
  };

  const startChange = () => {
    setChanging(true);
    setText("");
    setOpen(false);
    // Search may be back since the address was set: the next search finds out.
    setPinDown(false);
    results.retry();
    focusNext.current = "input";
  };
  const keepAddress = () => {
    setChanging(false);
    setText("");
    setOpen(false);
    setActive(-1);
    focusNext.current = "change";
  };
  const clear = () => {
    onChange(null);
    setChanging(false);
    setText("");
    focusNext.current = "input";
  };

  const openPin = () => {
    setPin({ centre: held?.point ?? near ?? LAGOS, at: null, found: null, naming: false });
    setOpen(false);
  };
  const tap = (point: LatLon) => {
    const seq = ++pinSeq.current;
    setPin((p) => (p ? { ...p, at: point, found: null, naming: true } : p));
    const name = (retried: boolean): Promise<void> =>
      places.pin(point, { level }).then(
        (named) => {
          if (seq === pinSeq.current) setPin((p) => (p ? { ...p, found: named, naming: false } : p));
        },
        (err: unknown) => {
          if (seq !== pinSeq.current) return;
          // As a search: one failure is asked once more, a second means search is down.
          if (isOutage(err) && !retried) setTimeout(() => void (seq === pinSeq.current && name(true)), RETRY_MS);
          else if (isOutage(err)) {
            setPinDown(true);
            setPin(null);
          } else setPin((p) => (p ? { ...p, naming: false } : p));
        },
      );
    void name(false);
  };
  const takePin = () => {
    if (pin?.found?.token) choose({ token: pin.found.token }, pin.found);
  };
  const cancelPin = () => {
    pinSeq.current += 1;
    setPin(null);
    focusNext.current = "input";
  };

  const tryAgain = () => {
    setPinDown(false);
    setNoLocation(null);
    results.retry();
    setOpen(true);
    focusNext.current = "input";
  };
  const takeLocation = async () => {
    setNoLocation(null);
    try {
      choose({ device: await locate() });
    } catch (err) {
      setNoLocation(err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === 1 ? "blocked" : "missing");
    }
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = found.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + n) % n);
    } else if (e.key === "Enter") {
      // Enter picks, or does nothing: what was typed is never sent as the address.
      if (listed && active >= 0) {
        e.preventDefault();
        pick(found[active]!);
      } else if (text.trim()) e.preventDefault();
    } else if (e.key === "Escape") {
      if (listed || nothing) {
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      } else if (held) {
        e.stopPropagation();
        keepAddress();
      }
    }
  };

  /** Leaving the field: what was typed and not picked goes, so the field shows what will be saved. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (box.current && e.relatedTarget instanceof Node && box.current.contains(e.relatedTarget)) return;
    setOpen(false);
    setActive(-1);
    if (!pin) {
      setText("");
      if (held) setChanging(false);
    }
    onBlur?.();
  };

  let line: ReactNode = null;
  if (held?.kind === "place") line = <span data-copy="content">{held.line}</span>;
  else if (held?.kind === "device")
    line = (
      <>
        <HelpTerm help={NAMED_LATER}>Current location</HelpTerm>
        {held.accuracy <= ROUGH_M ? `, within ${held.accuracy} m` : ", approximate"}
      </>
    );
  else if (held?.kind === "waiting") line = <HelpTerm help={NAMED_LATER}>{`Near ${describePoint(held.point)}`}</HelpTerm>;

  return (
    <div ref={box} className={className} onBlur={leave}>
      {searching ? (
        <>
          <span className="relative flex items-center">
            <input
              ref={input}
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
          {listed && (
            <>
              <p aria-live="polite" className="sr-only">{`${found.length} addresses found`}</p>
              <div id={listId} role="listbox" aria-label="Addresses" className="mt-1 max-h-64 overflow-y-auto rounded-box border border-border bg-popover">
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
                    onClick={() => pick(place)}
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
          {nothing && (
            <div className="px-3 pt-2">
              <p className="text-xs font-semibold">No address found</p>
              <p className="text-2xs text-subtle-foreground">Try a nearby landmark or street.</p>
            </div>
          )}
          {down ? (
            <div className="mt-2 rounded-box border border-border bg-muted px-3 py-2.5">
              <p role="status" className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon name="offline" size="s" />
                Address search is unavailable
              </p>
              {noLocation && <p className="mt-1 text-2xs text-destructive">{noLocation === "blocked" ? "Location blocked" : "Location not found"}</p>}
              <div className="mt-2 flex flex-col gap-2 desk:flex-row">
                <Button size="sm" icon="refresh" onClick={tryAgain}>
                  Try Again
                </Button>
                <Button size="sm" icon="locate" onClick={takeLocation}>
                  Use Current Location
                </Button>
              </div>
            </div>
          ) : pin ? (
            <div className="mt-2">
              <MapView
                interactive
                height="md"
                centre={pin.centre}
                zoom={level === "city" ? 11 : 16}
                loadTile={places.loadTile}
                markers={pin.at ? [{ key: "pin", lat: pin.at.lat, lon: pin.at.lon, label: pin.found?.formatted ?? "Pinned spot", tone: "brand" }] : []}
                onPick={tap}
              >
                {pin.naming ? (
                  <Spinner size="s" label="Searching" />
                ) : pin.found ? (
                  <p className="flex items-start gap-1.5 text-xs">
                    <Icon name={KIND_ICON[pin.found.kind ?? "unknown"]} size="s" className="mt-0.5 flex-none text-subtle-foreground" />
                    <span data-copy="content" className="min-w-0 wrap-any">
                      {pin.found.formatted}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Tap the spot</p>
                )}
              </MapView>
              <div className="mt-2 flex flex-col-reverse gap-2 desk:flex-row desk:justify-end">
                <Button size="sm" onClick={cancelPin}>
                  Cancel
                </Button>
                {pin.found && (
                  <Button size="sm" icon="ok" onClick={takePin}>
                    Use This Address
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" icon="pin" onClick={openPin}>
                Drop a Pin
              </Button>
              {held && (
                <Button variant="ghost" size="sm" onClick={keepAddress}>
                  Keep Address
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={cn(controlClass(a.state), "flex min-h-control items-start gap-2 py-2")}>
            <Icon name={held?.kind === "place" ? held.icon : "locate"} size="s" className="mt-1 flex-none text-subtle-foreground" />
            <span id={lineId} className="min-w-0 flex-1 wrap-any pt-0.5">
              {line}
            </span>
            {held?.kind === "place" && held.typed && (
              <Pill tone="warn" className="mt-0.5">
                <HelpTerm help="Typed before addresses were picked. Pick it again to confirm.">Unverified</HelpTerm>
              </Pill>
            )}
            <Button
              ref={change}
              variant="ghost"
              size="sm"
              onClick={startChange}
              aria-labelledby={labelId ? `${labelId} ${changeId}` : undefined}
              aria-describedby={[lineId, a["aria-describedby"]].filter(Boolean).join(" ")}
            >
              <span id={changeId}>Change</span>
            </Button>
            {optional && <IconButton icon="x" size="sm" label="Clear Address" onClick={clear} />}
          </div>
          {level === "address" && (
            <Field label="Details" optional help="House number, flat or directions. Printed before the address." className="mt-2.5 mb-0">
              <TextField
                value={value?.details ?? ""}
                onChange={(v) => value && onChange({ ...value, details: v === "" ? null : v })}
                placeholder="Flat 3, blue gate"
                maxLength={120}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
