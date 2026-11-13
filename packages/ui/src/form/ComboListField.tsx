/**
 * @component ComboListField
 * @group Forms
 * @summary Several values typed or picked, each a chip with Remove: the server suggests what is already in use, and what is typed that it does not know is added as it is.
 * @use A record's few short values from a list that new records may extend: a deal's impacts. The suggestions are a server-paged list, 25 at a time.
 * @avoid One value (ComboField); values that must come from a fixed list (SelectField, ChoiceField); people or records (PersonPicker, RecordPicker); places (PlacesField).
 * @phone The chips wrap above the field, each Remove a 44 px target; the suggestions open under the field as 44 px rows, Add and the typed text first.
 * @a11y A combobox over a listbox: arrows move, Enter adds, Esc closes; each chip's Remove names its value. Takes its label and error links from the Field around it.
 * @status beta
 * @example <ComboListField list={impacts} option={(i) => i.label} {...f.field("impact")} />
 */
import { useState, type ReactNode } from "react";
import { Icon } from "../icons/Icon";
import type { DataViewList } from "../data/DataView";
import type { FieldState } from "./binding";
import { ComboField } from "./ComboField";

export interface ComboListFieldProps<R> {
  /** The values held, from form.field(name): each a name as typed or picked. */
  value: string[];
  /** Called with the new list, a value added or removed. */
  onChange: (value: string[]) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** Unused here (the values are always the form's); accepted so {...form.field(name)} spreads cleanly. */
  onProblem?: (message: string | undefined, now?: boolean) => void;
  /** The form field's name, on the input. */
  name?: string;
  /** The control's id; the Field around it supplies one otherwise. */
  id?: string;
  /** The server-paged suggestions (a `usePaged()` result); the field drives its search as the person types. */
  list: DataViewList<R>;
  /** The value a suggestion adds. */
  option: (row: R) => string;
  /** The line beside a suggestion (how often it is used). */
  sub?: (row: R) => ReactNode;
  /** How many may be held; the box goes once that many are. */
  max?: number;
  /** A format example of at most 3 words. */
  placeholder?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A value as it is kept: spaces closed up, trimmed. */
const tidy = (v: string) => v.replace(/\s+/g, " ").trim();

export function ComboListField<R>({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, name, id, list, option, sub, max = 9, placeholder, className }: ComboListFieldProps<R>) {
  const [text, setText] = useState("");
  const held = value ?? [];
  const has = (v: string) => held.some((h) => h.toLowerCase() === v.toLowerCase());
  const full = held.length >= max;

  const add = (v: string) => {
    const t = tidy(v);
    if (t && !has(t) && !full) onChange([...held, t]);
    setText("");
  };
  const remove = (i: number) => onChange(held.filter((_, j) => j !== i));
  // A value already held is not suggested again.
  const offered: DataViewList<R> = { ...list, rows: list.rows.filter((r) => !has(option(r))) };

  /** Leaving the field: what was typed and not yet added is kept, never dropped. */
  const leave = () => {
    if (tidy(text)) add(text);
    onBlur?.();
  };

  return (
    <div className={className}>
      {held.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
          {held.map((v, i) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2.5 text-xs">
              <span data-copy="content">{v}</span>
              <button type="button" aria-label={`Remove ${v}`} onClick={() => remove(i)} className="flex size-5 items-center justify-center rounded-full hover:bg-card phone:size-tap">
                <Icon name="x" size="s" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && <ComboField<R> value={text} onChange={setText} onPick={add} onBlur={leave} state={state} name={name} id={id} list={offered} option={option} sub={sub} placeholder={placeholder} />}
    </div>
  );
}
