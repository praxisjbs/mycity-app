/**
 * @component SearchInput
 * @group Forms
 * @summary The one search box for a list, sent to the server as q; with FilterSelect, a labelled branded select in a filter row.
 * @use Above every list that searches; FilterSelect for one of a list's server filters.
 * @avoid Filtering the 25 rows on screen in the browser (FRONTEND_GUIDE §4); a second search box design.
 * @phone Full width, 44 px tall; the keyboard's search key; FilterSelect opens a branded bottom sheet, never the phone's own picker.
 * @a11y The box is a searchbox named by its label (or its placeholder); FilterSelect's label is visible and linked.
 * @status stable
 * @exports FilterSelect
 * @example <SearchInput label="Search Employees" placeholder="Name or Email" value={q} onChange={setQ} />
 */
import { useId, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { SelectMenu, type Option } from "./SelectField";

export interface SearchInputProps {
  /** What is typed; the list sends it as q (the list hook debounces it). */
  value: string;
  /** Called on each key. */
  onChange: (value: string) => void;
  /** A format example of at most 3 words; Search. */
  placeholder?: string;
  /** Names the box for assistive technology; the placeholder otherwise. */
  label?: string;
  /** Layout classes only. */
  className?: string;
  /** The id of the list this box narrows, when it moves through it (a searchable SelectField). */
  controls?: string;
  /** The id of that list's highlighted option. */
  activeId?: string;
  /** Keys pressed in the box (the arrow keys and Enter of that list). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/** Search box for a list. The text goes to the server as `q`. */
export function SearchInput({ value, onChange, placeholder = "Search", label, className, controls, activeId, onKeyDown }: SearchInputProps) {
  return (
    <span className={cn("flex h-control min-w-0 items-center gap-2 rounded-full border border-input bg-background px-3 text-field focus-within:border-ring", className)}>
      <Icon name="srch" size="s" className="text-subtle-foreground" />
      <input
        type="search"
        className="h-tap min-w-0 flex-1 border-0 bg-transparent outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        aria-controls={controls}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
      />
    </span>
  );
}

export interface FilterSelectProps {
  /** The filter's name, Title Case, visible above it. */
  label: string;
  /** The chosen value; "" for all. */
  value: string;
  /** Called with the chosen value. */
  onChange: (value: string) => void;
  /** The filter's options. */
  options: ReadonlyArray<Option>;
}

/** A labelled select in a filter row. Each value is sent to the server as a filter. */
export function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  const id = useId();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs font-semibold text-subtle-foreground">
        {label}
      </label>
      <SelectMenu
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={options}
        className="h-control w-full min-w-32 rounded-ctl border border-input bg-background px-3 text-field focus-visible:border-ring desk:w-auto desk:max-w-56"
      />
    </span>
  );
}
