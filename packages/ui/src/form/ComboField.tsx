/**
 * @component ComboField
 * @group Forms
 * @summary A value typed or picked: the server suggests what is already in use as the person types, and what they type that it does not know is kept as it is.
 * @use A short text that records tend to share and that new records may extend: a unit, a data source, a team name. The suggestions are a server-paged list, 25 at a time.
 * @avoid A value that must be one of a fixed list (SelectField, ChoiceField) or one that points at another record (RecordPicker, PersonPicker); an address (AddressField).
 * @phone The suggestions open under the field as 44 px rows inside the sheet's own scroll; Add and the typed text is the first row.
 * @a11y A combobox over a listbox: arrows move, Enter picks, Esc closes; the count found is announced. Takes its label and error links from the Field around it.
 * @status stable
 * @example <ComboField list={units} option={(u) => u.unit} {...f.field("unit")} />
 */
import { useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { Icon } from "../icons/Icon";
import type { DataViewList } from "../data/DataView";
import type { FieldState } from "./binding";
import { useFieldControl, useFieldLabelId } from "./Field";
import { controlClass } from "./TextField";

export interface ComboFieldProps<R> {
  /** The text, from form.field(name): typed, or put there by a pick. */
  value: string;
  /** Called with the new text, on each key and on a pick. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** Unused here (the text is always the form's); accepted so {...form.field(name)} spreads cleanly. */
  onProblem?: (message: string | undefined, now?: boolean) => void;
  /** The form field's name, on the input. */
  name?: string;
  /** The control's id; the Field around it supplies one otherwise. */
  id?: string;
  /** The server-paged suggestions (a `usePaged()` result); the field drives its search as the person types. */
  list: DataViewList<R>;
  /** The text a suggestion puts in the field. */
  option: (row: R) => string;
  /** The line beside a suggestion (how often it is used). */
  sub?: (row: R) => ReactNode;
  /** A format example of at most 3 words. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

type Item<R> = { key: string; add?: boolean; row?: R };

export function ComboField<R>({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, name, id, list, option, sub, placeholder, className }: ComboFieldProps<R>) {
  const { state: mark, ...aria } = useFieldControl({ id, state });
  const labelId = useFieldLabelId();
  const listId = `${useId().replace(/[^A-Za-z0-9_-]/g, "")}-combo`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const text = value ?? "";
  const typed = text.trim();
  // What was typed is offered as its own row until a suggestion says exactly that.
  const known = list.rows.some((r) => option(r).toLowerCase() === typed.toLowerCase());
  const items: Array<Item<R>> = [
    ...(typed && !known ? [{ key: "add", add: true }] : []),
    ...list.rows.map((row) => ({ key: `row:${option(row)}`, row })),
  ];
  const listed = open && items.length > 0;
  const total = list.page?.total ?? list.rows.length;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (item: Item<R>) => {
    onChange(item.add || !item.row ? typed : option(item.row));
    list.setQ?.("");
    close();
  };
  const typedIn = (next: string) => {
    onChange(next);
    list.setQ?.(next.trim());
    setOpen(true);
    setActive(-1);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      // Enter picks the row in hand; with none, it only closes the list, so what was typed stays.
      if (listed && active >= 0) {
        e.preventDefault();
        pick(items[active]!);
      } else if (listed) close();
    } else if (e.key === "Escape" && listed) {
      e.stopPropagation();
      close();
    }
  };

  /** Leaving the field, not moving inside it: the list goes and the form is told. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    close();
    onBlur?.();
  };

  return (
    <div className={className} onBlur={leave}>
      <span className="relative flex items-center">
        <input
          {...aria}
          name={name}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
          className={cn(controlClass(mark), "h-control", mark && "pr-9")}
          placeholder={placeholder}
          value={text}
          onChange={(e) => typedIn(e.target.value)}
          onFocus={() => {
            list.setQ?.("");
            setOpen(true);
          }}
          onKeyDown={keys}
        />
        {mark === "bad" && <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />}
        {mark === "good" && <Icon name="ok" size="s" className="pointer-events-none absolute right-3 text-success" />}
      </span>
      {listed && (
        <>
          <p aria-live="polite" className="sr-only">{`${formatCount(list.rows.length)} found`}</p>
          <div
            id={listId}
            role="listbox"
            aria-label={labelId ? undefined : (placeholder ?? "Suggestions")}
            aria-labelledby={labelId}
            className="mt-1 max-h-64 overflow-y-auto rounded-box border border-border bg-popover"
          >
            {items.map((item, i) => (
              <button
                key={item.key}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // The field keeps focus while a row is pressed, so the list is still there for the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted phone:min-h-tap",
                  i === active && "bg-muted",
                )}
              >
                {item.add ? (
                  <>
                    <Icon name="plus" size="s" className="flex-none text-subtle-foreground" />
                    <span className="min-w-0 flex-1 wrap-any">
                      Add <b data-copy="content">{`“${typed}”`}</b>
                    </span>
                  </>
                ) : (
                  <>
                    <span data-copy="content" className="min-w-0 flex-1 font-semibold wrap-any">
                      {option(item.row!)}
                    </span>
                    {sub && <span className="flex-none text-2xs text-subtle-foreground">{sub(item.row!)}</span>}
                  </>
                )}
              </button>
            ))}
          </div>
          {total > list.rows.length && (
            <p className="px-3 pt-1.5 text-2xs text-subtle-foreground">
              First {formatCount(list.rows.length)} of {formatCount(total)}. Type to narrow.
            </p>
          )}
        </>
      )}
    </div>
  );
}
