/**
 * @component SelectField
 * @group Forms
 * @summary Pick one value: our own branded list (SelectMenu underneath), or for five options or fewer a segmented choice (ChoiceField).
 * @use SelectField for more than five options; ChoiceField for two to five, so every option is visible at once; SelectMenu for a widget that styles its own button (FilterSelect, InlineSelect).
 * @avoid Long or server-held lists (people, records): use the server-searching picker; a yes or no (use CheckboxField or Switch); a raw <select> anywhere (gate 21: the browser's own picker is never shown).
 * @phone SelectField opens a branded bottom sheet of 44 px rows with a tick on the chosen one, never the phone's own picker; ChoiceField segments are 44 px tall and wrap rather than scroll.
 * @a11y Desktop: a Radix listbox (arrow keys, typing jumps, Enter chooses, Esc closes, focus returns to the button), named by its Field. Phone: a sheet named by the field's label holding a listbox. ChoiceField is a radio group with arrow-key movement.
 * @status stable
 * @exports ChoiceField, SelectMenu
 * @example <SelectField placeholder="Choose One" options={[["ops", "Operations"], ["hr", "People"]]} {...form.field("department")} />
 */
import { useRef, useState, type ReactNode } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Radix from "@radix-ui/react-select";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import type { FieldState } from "./binding";
import { useFieldControl, useFieldLabelId } from "./Field";
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
}

/**
 * The one select in the product. Desktop: a Radix listbox drawn in our tokens,
 * anchored under the button. Phone: a bottom sheet of 44 px rows. The browser's
 * own picker never shows (gate 21).
 */
export function SelectMenu({ value, onChange, onBlur, options, placeholder, label, className, id, disabled, name, container, ...aria }: SelectMenuProps) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const labelId = useFieldLabelId();
  const list = options.map(optionOf);
  const chosen = list.find((o) => o.value === (value ?? ""));
  const shown = chosen ? chosen.label : placeholder;
  const chevron = <Icon name="down" size="s" className="flex-none text-subtle-foreground" />;
  const text = (
    <span className={cn("min-w-0 flex-1 truncate", !chosen && "text-subtle-foreground")} data-copy={chosen ? "content" : undefined}>
      {shown}
    </span>
  );

  if (phone) {
    // The sheet is named by the field's label as a person reads it.
    const title = () => label || (labelId && document.getElementById(labelId)?.textContent?.trim()) || aria["aria-label"] || placeholder || "Choose One";
    const pick = (v: string) => {
      onChange(v);
      setOpen(false);
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
            onBlur?.();
          }}
          title={open ? title() : ""}
          container={container}
          bodyClassName="px-2 py-2"
        >
          <div role="listbox" aria-label={open ? title() : undefined}>
            {list.map((o) => {
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
        </Sheet>
      </>
    );
  }

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
          </Radix.Viewport>
          <Radix.ScrollDownButton className="flex h-6 items-center justify-center text-subtle-foreground">
            <Icon name="down" size="s" />
          </Radix.ScrollDownButton>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
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
  const a = useFieldControl({ state });
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
