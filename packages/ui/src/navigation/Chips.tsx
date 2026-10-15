/**
 * @component Chips
 * @group Navigation
 * @summary A row of filter chips above a list, each with an optional count: one chosen (single select) or several switched on (toggle).
 * @use Narrowing a list by a status or a group (Everyone, Late 4, Remote 2); a board's stage switcher on a phone (F19); picking several departments with `selected`.
 * @avoid Switching between views (use SegmentedControl or Tabs); a choice inside a form (use ChoiceField or CheckboxField); a status shown on a record (use Pill).
 * @phone One row that scrolls sideways inside itself, never the page; each chip is a 44 px target.
 * @a11y A group named by `label`; each chip is a button with aria-pressed, so a screen reader hears which are on. The count is read with the label (Late 4).
 * @status stable
 * @example <Chips label="Status" value={status} onChange={setStatus} options={[["all", "Everyone"], { value: "late", label: "Late", count: 4 }]} />
 * @example <Chips label="Departments" selected={depts} onSelectedChange={setDepts} options={departments.map((d) => [d.name, d.name])} />
 */
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { Icon } from "../icons/Icon";
import { WORD_LIMITS, warnOverLimit } from "../help/words";
import { toOption, type Choice } from "./options";

export interface ChipsProps<V extends string = string> {
  /** The merged tuple ["late", "Late"], or { value, label, count, icon, disabled }. Labels Title Case, at most 3 words; counts as numbers. */
  options: ReadonlyArray<Choice<V>>;
  /** Single select: the chip that is on. */
  value?: V;
  /** Single select: called with the chip pressed. */
  onChange?: (value: V) => void;
  /** Toggle: the chips that are on (several may be). Using it switches the row to toggle mode. */
  selected?: readonly V[];
  /** Toggle: called with the new set after a chip is switched on or off. */
  onSelectedChange?: (selected: V[]) => void;
  /** Names the row for assistive technology ("Status", "Departments"). */
  label?: string;
  /** Layout classes only (spacing); the row keeps the merged 12 px gap below it unless overridden. */
  className?: string;
}

export function Chips<V extends string = string>({ options, value, onChange, selected, onSelectedChange, label, className }: ChipsProps<V>) {
  const items = options.map(toOption);
  const toggle = selected !== undefined;
  for (const item of items) warnOverLimit("Chip", item.label, WORD_LIMITS.button);

  const press = (v: V) => {
    if (!toggle) return v !== value && onChange?.(v);
    const set = selected ?? [];
    onSelectedChange?.(set.includes(v) ? set.filter((x) => x !== v) : [...set, v]);
  };

  return (
    <div role="group" aria-label={label} className={cn("no-scrollbar mb-3 flex max-w-full gap-1.5 overflow-x-auto desk:flex-wrap", className)}>
      {items.map((item) => {
        const on = toggle ? (selected ?? []).includes(item.value) : item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={on}
            disabled={item.disabled}
            data-ui="button"
            onClick={() => press(item.value)}
            className={cn(
              "inline-flex h-7.5 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-(--dur-fast) disabled:opacity-40 phone:min-h-tap phone:min-w-tap phone:justify-center",
              on
                ? "border-secondary bg-secondary text-secondary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-subtle-foreground hover:text-foreground",
            )}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
            {item.count != null && " "}
            {item.count != null && (
              <span className={cn("tabular-nums", on ? "text-secondary-foreground" : "text-foreground")}>{formatCount(item.count)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
