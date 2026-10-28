/**
 * @component SelectField
 * @group Forms
 * @summary Pick one value: our own branded list (SelectMenu underneath), or for five options or fewer a segmented choice (ChoiceField).
 * @use SelectField for more than five options, `searchable` once a fixed list is long enough to scroll (a purpose, a country); options from a server list with `more` and `onMore`, so its next 25 load as the menu nears its end; ChoiceField for two to five, so every option is visible at once; SelectMenu for a widget that styles its own button (FilterSelect, InlineSelect).
 * @avoid People and records a person searches for (use the server-searching picker); options cut to one page of a server list (pass `more` and `onMore`); a yes or no (use CheckboxField or Switch); a raw <select> anywhere (gate 21: the browser's own picker is never shown).
 * @phone SelectField opens a branded bottom sheet of 44 px rows with a tick on the chosen one, never the phone's own picker, and a searchable one a search box above them; a server list's next 25 load as the sheet nears its end; ChoiceField segments are 44 px tall and wrap rather than scroll.
 * @a11y Desktop: a Radix listbox (arrow keys, typing jumps, Enter chooses, Esc closes, focus returns to the button), named by its Field; a searchable one a search box that owns the listbox (arrow keys move through what matches, Enter chooses). Phone: a sheet named by the field's label holding a listbox. Moving through a server list with the keys loads its next 25 as the end nears; the spinner that ends it is hidden from assistive technology. ChoiceField is a radio group with arrow-key movement.
 * @status stable
 * @exports ChoiceField, SelectMenu
 * @example <SelectField placeholder="Choose One" options={[["ops", "Operations"], ["hr", "People"]]} {...form.field("department")} />
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Pop from "@radix-ui/react-popover";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Radix from "@radix-ui/react-select";
import { Spinner } from "../display/Skeleton";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import type { FieldState } from "./binding";
import { useFieldControl, useFieldLabelId } from "./Field";
import { SearchInput } from "./SearchInput";
import { controlClass } from "./TextField";

/** An option: the merged tuple [value, label], or { value, label }. */
export type Option<V extends string = string> = readonly [V, ReactNode] | { value: V; label: ReactNode; disabled?: boolean };

const optionOf = <V extends string>(o: Option<V>) => (Array.isArray(o) ? { value: o[0] as V, label: o[1] as ReactNode, disabled: false } : (o as { value: V; label: ReactNode; disabled?: boolean }));

/** Radix keeps "" for "nothing chosen", so an option whose value is "" (All) travels under this key. */
const NONE = "\u0000none";
const toKey = (v: string) => (v === "" ? NONE : v);
const fromKey = (k: string) => (k === NONE ? "" : k);

/** The button every select draws: the chosen label, or the placeholder, and a chevron. */
const TRIGGER = "flex items-center justify-between gap-2 text-left outline-none disabled:opacity-60";

/** The words an option is found by: its label when that is text, its value otherwise. */
const wordsOf = (o: { value: string; label: ReactNode }) => (typeof o.label === "string" || typeof o.label === "number" ? String(o.label) : o.value).toLowerCase();

/** The options whose words hold what was typed, in their own order. */
function matching<O extends { value: string; label: ReactNode }>(list: O[], q: string): O[] {
  const t = q.trim().toLowerCase();
  return t ? list.filter((o) => wordsOf(o).includes(t)) : list;
}

export interface SelectMenuProps {
  /** The chosen value; "" for none (or for an option whose value is ""). */
  value: string;
  /** Called with the chosen value. */
  onChange: (value: string) => void;
  /** Called when the list closes. */
  onBlur?: () => void;
  /** The options. */
  options: ReadonlyArray<Option>;
  /** Shown on the button while nothing is chosen. */
  placeholder?: string;
  /** The sheet's title on a phone and the list's name; the label above the button otherwise. */
  label?: string;
  /** The button's classes: the caller's widget draws it (a field, a filter, a row in a composer). */
  className?: string;
  /** The button's id, so a <label for> names it. */
  id?: string;
  /** Names the button when no label is linked to it. */
  "aria-label"?: string;
  /** The id of the label that names it (a Field supplies it). */
  "aria-labelledby"?: string;
  /** The ids of its help and error (a Field supplies them). */
  "aria-describedby"?: string;
  /** Marks it wrong for assistive technology (a Field supplies it). */
  "aria-invalid"?: boolean;
  /** Shown but not usable. */
  disabled?: boolean;
  /** Its name in a submitted form. */
  name?: string;
  /** Where the list mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** A search box above the options, narrowing them as the person types: for a fixed list long enough to scroll. */
  searchable?: boolean;
  /** The options are a server list with more pages to load (FRONTEND_GUIDE §4). */
  more?: boolean;
  /** Loads the server list's next 25; called as the menu nears its end, or as it opens too short to scroll. */
  onMore?: () => unknown;
  /** The chosen value's label while it is on a page not loaded yet (a saved record's own name). */
  valueLabel?: ReactNode;
}

/** How near the end of the list, in pixels, the next page is asked for: about three rows. */
const NEAR_END_PX = 120;

/** The nearest box around `el` that scrolls: the listbox, the panel or the sheet's body. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/**
 * A server list's next page while the menu is open: asked once per length of the list, when
 * whatever scrolls it nears the end (a scroll, a key that moves past the rows in view) and when
 * it opens or grows still too short to scroll. Hands back the ref of the row that ends the list.
 */
function useNearEnd(open: boolean, count: number, more: boolean | undefined, onMore: (() => unknown) | undefined) {
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const asked = useRef(-1);
  const check = useCallback(
    (box: Element) => {
      if (!more || !onMore || asked.current === count) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - NEAR_END_PX) {
        asked.current = count;
        // A touch scroll leaves focus on an option far above. When the next rows arrive, the desktop
        // list's scroll button brings the focused option back into view, and the list would jump to
        // its top: the list itself takes focus, as when the pointer leaves an option.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.getAttribute("role") === "option" && box.contains(focused)) {
          const at = focused.getBoundingClientRect();
          const shown = box.getBoundingClientRect();
          if (at.bottom <= shown.top || at.top >= shown.bottom) (focused.closest<HTMLElement>("[role=listbox]") ?? box).focus({ preventScroll: true });
        }
        void onMore();
      }
    },
    [more, onMore, count],
  );
  useEffect(() => {
    if (!open || !end || !more) return;
    // A scroll does not bubble: the document hears it on the way down, from whichever box holds the end.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.contains(end)) check(e.target);
    };
    document.addEventListener("scroll", onScroll, true);
    const box = scrollerOf(end);
    if (box) check(box);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [open, end, more, check]);
  return setEnd;
}

/** The row that ends a server list with more to load, its spinner turning while the next page comes. */
const MoreRow = ({ end }: { end: (el: HTMLElement | null) => void }) => (
  <div ref={end} aria-hidden="true" className="flex h-row items-center justify-center">
    <Spinner />
  </div>
);

/**
 * The one select in the product. Desktop: a Radix listbox drawn in our tokens,
 * anchored under the button, or for a searchable one a search box over the list.
 * Phone: a bottom sheet of 44 px rows, a searchable one with the search box on top.
 * Options from a server list load 25 at a time as the list nears its end (`more`).
 * The browser's own picker never shows (gate 21).
 */
export function SelectMenu({ value, onChange, onBlur, options, placeholder, label, className, id, disabled, name, container, searchable, more, onMore, valueLabel, ...aria }: SelectMenuProps) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const labelId = useFieldLabelId();
  const list = options.map(optionOf);
  const shownList = searchable ? matching(list, q) : list;
  const end = useNearEnd(open, list.length, more, onMore);
  // The list is named by the field's label as a person reads it.
  const title = () => label || (labelId && document.getElementById(labelId)?.textContent?.trim()) || aria["aria-label"] || placeholder || "Choose One";
  const chosen = list.find((o) => o.value === (value ?? ""));
  // A value from a page not loaded yet still reads as itself.
  const named = chosen ? chosen.label : value && valueLabel ? valueLabel : undefined;
  const shown = named ?? placeholder;
  const chevron = <Icon name="down" size="s" className="flex-none text-subtle-foreground" />;
  const text = (
    <span className={cn("min-w-0 flex-1 truncate", named === undefined && "text-subtle-foreground")} data-copy={named === undefined ? undefined : "content"}>
      {shown}
    </span>
  );

  if (phone) {
    const pick = (v: string) => {
      onChange(v);
      setOpen(false);
      setQ("");
    };
    return (
      <>
        <button
          ref={button}
          type="button"
          id={id}
          name={name}
          value={value ?? ""}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          {...aria}
          onClick={() => setOpen(true)}
          className={cn(TRIGGER, className)}
        >
          {text}
          {chevron}
        </button>
        <Sheet
          open={open}
          onClose={() => {
            setOpen(false);
            setQ("");
            onBlur?.();
          }}
          title={open ? title() : ""}
          container={container}
          bodyClassName="px-2 py-2"
        >
          {searchable && <SearchInput className="mx-1 mb-2" value={q} onChange={setQ} label={`Search ${open ? title() : ""}`.trim()} />}
          {searchable && !shownList.length && <Nothing />}
          <div role="listbox" aria-label={open ? title() : undefined}>
            {shownList.map((o) => {
              const on = o.value === (value ?? "");
              return (
                <button
                  key={toKey(o.value)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-value={o.value}
                  disabled={o.disabled}
                  data-autofocus={on || undefined}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "flex min-h-tap w-full items-center gap-3 rounded-box px-3 text-left text-md outline-none focus-visible:bg-muted active:bg-muted disabled:opacity-45",
                    on && "font-semibold",
                  )}
                >
                  <span className="min-w-0 flex-1" data-copy="content">
                    {o.label}
                  </span>
                  {on && <Icon name="tick" size="s" className="flex-none text-secondary" />}
                </button>
              );
            })}
          </div>
          {more && <MoreRow end={end} />}
        </Sheet>
      </>
    );
  }

  if (searchable)
    return (
      <SearchMenu
        list={shownList}
        q={q}
        setQ={setQ}
        value={value ?? ""}
        open={open}
        setOpen={(o) => {
          setOpen(o);
          if (!o) {
            setQ("");
            onBlur?.();
          }
        }}
        onChange={onChange}
        label={open ? title() : label}
        container={container}
        end={more ? end : undefined}
        trigger={
          <button ref={button} type="button" id={id} name={name} value={value ?? ""} disabled={disabled} role="combobox" aria-haspopup="listbox" aria-expanded={open} {...aria} className={cn(TRIGGER, className)}>
            {text}
            {chevron}
          </button>
        }
      />
    );

  return (
    <Radix.Root
      value={chosen ? toKey(chosen.value) : ""}
      onValueChange={(k) => onChange(fromKey(k))}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onBlur?.();
      }}
      disabled={disabled}
      name={name}
    >
      <Radix.Trigger ref={button} id={id} value={value ?? ""} {...aria} className={cn(TRIGGER, className)}>
        {text}
        <Radix.Icon asChild>{chevron}</Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal container={container ?? undefined}>
        <Radix.Content
          position="popper"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) animate-rise overflow-hidden rounded-box border border-border bg-popover text-popover-foreground shadow-3"
        >
          <Radix.ScrollUpButton className="flex h-6 items-center justify-center text-subtle-foreground">
            <Icon name="up" size="s" />
          </Radix.ScrollUpButton>
          <Radix.Viewport className="max-h-80 p-1">
            {list.map((o) => (
              <Radix.Item
                key={toKey(o.value)}
                value={toKey(o.value)}
                data-value={o.value}
                disabled={o.disabled}
                className="flex h-row cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-body outline-none select-none data-disabled:cursor-default data-disabled:opacity-45 data-highlighted:bg-muted data-[state=checked]:font-semibold"
              >
                <Radix.ItemText>
                  <span data-copy="content">{o.label}</span>
                </Radix.ItemText>
                <Radix.ItemIndicator className="ml-auto flex-none text-secondary">
                  <Icon name="tick" size="s" />
                </Radix.ItemIndicator>
              </Radix.Item>
            ))}
            {more && <MoreRow end={end} />}
          </Radix.Viewport>
          <Radix.ScrollDownButton className="flex h-6 items-center justify-center text-subtle-foreground">
            <Icon name="down" size="s" />
          </Radix.ScrollDownButton>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

/** What a search that matches no option shows. */
const Nothing = () => (
  <p className="px-3 py-2 text-sm text-subtle-foreground" role="status">
    Nothing matches
  </p>
);

/**
 * A searchable select on desktop: the button opens a panel with a search box that owns the list
 * (aria-activedescendant), so typing narrows it and the arrow keys and Enter choose without
 * leaving the box.
 */
function SearchMenu({
  list,
  q,
  setQ,
  value,
  open,
  setOpen,
  onChange,
  label,
  container,
  end,
  trigger,
}: {
  list: Array<{ value: string; label: ReactNode; disabled?: boolean }>;
  q: string;
  setQ: (q: string) => void;
  value: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onChange: (value: string) => void;
  label?: string;
  container?: HTMLElement | null;
  /** The ref of the row that ends a server list with more to load. */
  end?: (el: HTMLElement | null) => void;
  trigger: ReactNode;
}) {
  const base = useId();
  const [active, setActive] = useState(0);
  const usable = list.filter((o) => !o.disabled);
  const at = Math.min(active, Math.max(usable.length - 1, 0));
  const optionId = (v: string) => `${base}-${toKey(v).replace(/[^\w-]/g, "_")}`;
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(at + step, 0), Math.max(usable.length - 1, 0)));
    } else if (e.key === "Enter" && usable[at]) {
      e.preventDefault();
      pick(usable[at].value);
    }
  };
  return (
    <Pop.Root
      open={open}
      onOpenChange={(o) => {
        setActive(0);
        setOpen(o);
      }}
    >
      <Pop.Trigger asChild>{trigger}</Pop.Trigger>
      <Pop.Portal container={container ?? undefined}>
        <Pop.Content
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-(--radix-popover-trigger-width) min-w-56 animate-rise rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-3 outline-none"
        >
          <SearchInput
            className="mb-1"
            value={q}
            onChange={(next) => {
              setQ(next);
              setActive(0);
            }}
            label={label ? `Search ${label}` : "Search"}
            controls={`${base}-list`}
            activeId={usable[at] ? optionId(usable[at].value) : undefined}
            onKeyDown={keys}
          />
          {!list.length && <Nothing />}
          <div id={`${base}-list`} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
            {list.map((o) => {
              const on = o.value === value;
              const lit = usable[at]?.value === o.value;
              return (
                <button
                  key={toKey(o.value)}
                  id={optionId(o.value)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={on}
                  data-value={o.value}
                  data-highlighted={lit || undefined}
                  disabled={o.disabled}
                  onClick={() => pick(o.value)}
                  onMouseEnter={() => setActive(Math.max(usable.indexOf(o), 0))}
                  className={cn(
                    "flex h-row w-full cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-left text-body outline-none select-none disabled:cursor-default disabled:opacity-45 data-highlighted:bg-muted",
                    on && "font-semibold",
                  )}
                >
                  <span className="min-w-0 flex-1" data-copy="content">
                    {o.label}
                  </span>
                  {on && <Icon name="tick" size="s" className="flex-none text-secondary" />}
                </button>
              );
            })}
            {end && <MoreRow end={end} />}
          </div>
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

export interface SelectFieldProps {
  /** The chosen value; "" for none. */
  value: string;
  /** Called with the chosen value. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The options. */
  options: ReadonlyArray<Option>;
  /** Shown on the button while nothing is chosen (Choose One). */
  placeholder?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Its name in a submitted form. */
  name?: string;
  /** Shown but not usable. */
  disabled?: boolean;
  /** Names it when no Field label sits above it. */
  "aria-label"?: string;
  /** Layout classes only. */
  className?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
  /** Where the list mounts; document.body by default. */
  container?: HTMLElement | null;
  /** A search box above the options (SelectMenu's `searchable`). */
  searchable?: boolean;
  /** The options are a server list with more pages to load (SelectMenu's `more`). */
  more?: boolean;
  /** Loads the server list's next 25 as the menu nears its end (SelectMenu's `onMore`). */
  onMore?: () => unknown;
  /** The chosen value's label while it is on a page not loaded yet (SelectMenu's `valueLabel`). */
  valueLabel?: ReactNode;
}

export function SelectField({ value, onChange, onBlur, options, placeholder, state, message: _message, className, id, ...rest }: SelectFieldProps) {
  const { state: mark, ...a } = useFieldControl({ id, state });
  return (
    <SelectMenu
      {...rest}
      {...a}
      value={value ?? ""}
      onChange={onChange}
      onBlur={onBlur}
      options={options}
      placeholder={placeholder}
      className={cn(controlClass(mark), "h-control", className)}
    />
  );
}

export interface ChoiceFieldProps<V extends string = string> {
  /** The chosen value. */
  value: V;
  /** Called with the chosen value. */
  onChange: (value: V) => void;
  /** Called when focus leaves the group. */
  onBlur?: () => void;
  /** Two to five options. */
  options: ReadonlyArray<Option<V>>;
  /** Values shown but not choosable (the merged `disabled`). */
  disabled?: readonly V[];
  /** Names the group when no Field label sits above it. */
  label?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Layout classes only. */
  className?: string;
}

/** Two to five options as one segmented row (the merged Seg). */
export function ChoiceField<V extends string = string>({ value, onChange, onBlur, options, disabled, label, state, message: _message, className }: ChoiceFieldProps<V>) {
  // A radio group is not named by <label for>: inside a Field, its label names it by id.
  const a = useFieldControl({ state, group: true });
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as V)}
      onBlur={onBlur}
      aria-label={label}
      aria-labelledby={label ? undefined : a["aria-labelledby"]}
      aria-describedby={a["aria-describedby"]}
      aria-invalid={a["aria-invalid"]}
      orientation="horizontal"
      className={cn("flex flex-wrap gap-1 rounded-box border border-input p-1", a.state === "bad" && "border-destructive", className)}
    >
      {options.map((o) => {
        const { value: v, label: text, disabled: off } = optionOf(o);
        return (
          <RadioGroup.Item
            key={v}
            value={v}
            disabled={off || disabled?.includes(v)}
            data-ui="button"
            className="h-8 min-h-tap flex-1 rounded-ctl px-2.5 text-sm font-semibold whitespace-nowrap text-muted-foreground disabled:opacity-45 data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground phone:h-tap"
          >
            {text}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
