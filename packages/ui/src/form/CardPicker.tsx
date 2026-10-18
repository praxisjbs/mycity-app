/**
 * @component CardPicker
 * @group Forms
 * @summary The cards a person puts on a KPI row: tick up to four, keep them in order with Move Up and Move Down, the cards their role fixes locked and first.
 * @use Choose Cards on Home, and a role's cards on Settings: inside a Modal whose footer holds Cancel, any reset and the save.
 * @avoid A yes or no in a form (use CheckboxField); a choice of one (ChoiceField or SelectField); Save or Cancel inside it (the dialog's footer holds them); dragging to reorder.
 * @phone The chosen cards first with Move Up and Move Down, then the rest; each tick and button is a 44 px target, the buttons drop under the title when the row is narrow, and the count is left off.
 * @a11y A named group of real checkboxes, each labelled by its card's title; a locked card's tick is checked, disabled and described as Locked. Move Up and Move Down are worded buttons named for their card, unavailable (not removed) at either end, and focus stays with a card as it moves. A polite status reads the count after a tick, a card's new place after a move, and the limit when a pick is refused; the refused tick is marked invalid and described by the error.
 * @status beta
 * @example <CardPicker label="Overview Cards" options={cards} value={draft} onChange={setDraft} />
 */
import { useLayoutEffect, useRef, useState } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import { cn } from "../lib/cn";
import { describedBy, useControlIds } from "../lib/ids";
import { slot } from "../lib/slots";
import { Icon } from "../icons/Icon";
import { Button } from "../actions/Button";
import { Pill } from "../display/Pill";

/** A row of KPI cards holds four. */
const ROW_OF_CARDS = 4;

/** One card the person may choose. */
export interface CardPickerOption {
  /** The card's key, as the server knows it ("attendance_today"). */
  id: string;
  /** Its title, as the card shows it: Title Case, at most 4 words. */
  title: string;
  /** Fixed by the person's role: always chosen, always first, never taken off or moved. */
  locked?: boolean;
}

export interface CardPickerProps {
  /** Every card the person may choose, in the order the catalogue lists them. Only cards they may see: never a greyed one. */
  options: CardPickerOption[];
  /**
   * The chosen card ids, in the order the row shows them. Locked cards are chosen
   * and lead whether or not they are listed here; an id with no option is dropped.
   */
  value: string[];
  /** Called with the next chosen ids, locked first, after a tick or a move. A tick never takes it past `max`. */
  onChange: (next: string[]) => void;
  /** How many cards may be chosen; 4, a row of KPI cards. */
  max?: number;
  /** The group's accessible name, Title Case ("Overview Cards"); the dialog's title is the visible one. */
  label: string;
  /** Layout classes only (spacing). */
  className?: string;
}

type Part = "tick" | "up" | "down";

/** Where a control of one card is found again after a render: its part and the card's id. */
const targetKey = (part: Part, id: string) => `${part}:${id}`;

/**
 * The chosen ids as the row shows them: the locked cards first (in the given
 * order, then any the value left out, in the catalogue's), then the rest in the
 * person's order. Repeats and ids with no option are dropped.
 */
function arrange(options: CardPickerOption[], value: string[]) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const picked = [...new Set(value)].flatMap((id) => byId.get(id) ?? []);
  const locked = [...picked.filter((o) => o.locked), ...options.filter((o) => o.locked && !picked.includes(o))];
  const chosenCards = [...locked, ...picked.filter((o) => !o.locked)];
  const others = options.filter((o) => !chosenCards.includes(o));
  return { byId, chosenCards, chosen: chosenCards.map((o) => o.id), lockedCount: locked.length, others };
}

export function CardPicker({ options, value, onChange, max = ROW_OF_CARDS, label, className }: CardPickerProps) {
  const ids = useControlIds("cards");
  const { byId, chosenCards, chosen, lockedCount, others } = arrange(options, value);
  const countId = `${ids.id}-count`;
  const order = JSON.stringify(chosen);
  const full = chosen.length >= max;
  const limit = `Pick up to ${max} ${max === 1 ? "card" : "cards"}`;

  /* The card whose tick was refused at the limit, and the row it met: the error goes as soon as the row changes. */
  const [refused, setRefused] = useState<{ id: string; order: string } | null>(null);
  const refusedId = refused?.order === order ? refused.id : null;

  /* What the status line says; `n` makes the same words a new node, so they are read again. */
  const [note, setNote] = useState<{ n: number; text: string } | null>(null);
  const say = (text: string) => setNote((last) => ({ n: (last?.n ?? 0) + 1, text }));

  /*
   * A card moves in the list when it is ticked, unticked or reordered, and its
   * row can be remounted on the way, which drops focus. The control that was
   * pressed is focused again once the value it asked for arrives.
   */
  const targets = useRef(new Map<string, HTMLButtonElement>());
  const pending = useRef<{ target: string; order: string } | null>(null);
  useLayoutEffect(() => {
    const want = pending.current;
    if (!want || want.order !== order) return;
    pending.current = null;
    targets.current.get(want.target)?.focus();
  }, [order]);

  const target = (part: Part, id: string) => (el: HTMLButtonElement | null) => {
    if (el) targets.current.set(targetKey(part, id), el);
    else targets.current.delete(targetKey(part, id));
  };

  const commit = (next: string[], part: Part, id: string, text: string) => {
    pending.current = { target: targetKey(part, id), order: JSON.stringify(next) };
    say(text);
    onChange(next);
  };

  const tick = (id: string, on: boolean) => {
    const card = byId.get(id);
    if (!card || card.locked || on === chosen.includes(id)) return;
    if (on && full) {
      setRefused({ id, order });
      say(limit);
      return;
    }
    const next = on ? [...chosen, id] : chosen.filter((x) => x !== id);
    commit(next, "tick", id, `${next.length} of ${max}`);
  };

  const move = (id: string, by: -1 | 1) => {
    const from = chosen.indexOf(id);
    const to = from + by;
    if (from < lockedCount || to < lockedCount || to >= chosen.length) return;
    const next = [...chosen];
    next.splice(to, 0, ...next.splice(from, 1));
    commit(next, by < 0 ? "up" : "down", id, `${byId.get(id)?.title} moved to ${to + 1} of ${next.length}`);
  };

  const row = (card: CardPickerOption) => {
    const at = chosen.indexOf(card.id);
    const movable = at >= lockedCount;
    return (
      <CardRow
        key={card.id}
        card={card}
        chosen={at >= 0}
        moves={movable ? { up: at > lockedCount, down: at < chosen.length - 1 } : null}
        error={refusedId === card.id ? limit : null}
        onTick={(on) => tick(card.id, on)}
        onMove={(by) => move(card.id, by)}
        target={(part) => target(part, card.id)}
      />
    );
  };

  return (
    <div role="group" aria-label={label} aria-describedby={countId} className={cn("flex flex-col gap-2", className)}>
      <p id={countId} className="text-right text-xs text-muted-foreground tabular-nums phone:hidden">
        {chosen.length} of {max}
      </p>
      {chosen.length > 0 && (
        <ul className="m-0 list-none divide-y divide-border rounded-box border border-border px-2">{chosenCards.map(row)}</ul>
      )}
      {others.length > 0 && <ul className="m-0 list-none divide-y divide-border px-2">{others.map(row)}</ul>}
      <div role="status" className="sr-only">
        {note && <span key={note.n}>{note.text}</span>}
      </div>
    </div>
  );
}

interface CardRowProps {
  card: CardPickerOption;
  /** On the row now (a locked card always is). */
  chosen: boolean;
  /** Which way a chosen, unlocked card can go; null when it cannot move at all. */
  moves: { up: boolean; down: boolean } | null;
  /** The limit, on the card whose tick was refused. */
  error: string | null;
  /** Called with the tick's new state. */
  onTick: (on: boolean) => void;
  /** Called with -1 to move the card up one place, 1 to move it down. */
  onMove: (by: -1 | 1) => void;
  /** The ref that lets the picker focus this card's tick or move button again. */
  target: (part: Part) => (el: HTMLButtonElement | null) => void;
}

/** One card: its tick and title, then its Locked pill or its Move Up and Move Down. */
function CardRow({ card, chosen, moves, error, onTick, onMove, target }: CardRowProps) {
  const ids = useControlIds("card");
  const lockedId = `${ids.id}-locked`;
  return (
    <li className="flex items-start gap-1 py-1">
      <Checkbox.Root
        ref={target("tick")}
        id={ids.id}
        checked={chosen}
        disabled={card.locked}
        onCheckedChange={(v) => onTick(v === true)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(card.locked && lockedId, error && ids.errorId)}
        className="group flex size-tap flex-none items-center justify-center rounded-ctl disabled:opacity-50"
      >
        <span
          className={cn(
            "flex size-4.5 items-center justify-center rounded-sm border bg-background group-data-[state=checked]:border-secondary group-data-[state=checked]:bg-secondary group-data-[state=checked]:text-secondary-foreground",
            error ? "border-destructive" : "border-input",
          )}
        >
          <Checkbox.Indicator>
            <Icon name="ok" size="s" />
          </Checkbox.Indicator>
        </span>
      </Checkbox.Root>
      <div className="flex min-w-0 flex-auto flex-wrap items-center gap-x-2">
        <label htmlFor={ids.id} {...slot("title")} className="flex min-h-tap min-w-0 flex-auto items-center text-sm font-semibold">
          {card.title}
        </label>
        {card.locked && (
          <span id={lockedId}>
            <Pill>Locked</Pill>
          </span>
        )}
        {moves && (
          <span className="ml-auto flex gap-1">
            <MoveButton dir="up" able={moves.up} title={card.title} onMove={onMove} buttonRef={target("up")} />
            <MoveButton dir="down" able={moves.down} title={card.title} onMove={onMove} buttonRef={target("down")} />
          </span>
        )}
        {error && (
          <p id={ids.errorId} className="flex basis-full items-center gap-1 text-xs text-destructive">
            <Icon name="alert" size="s" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </li>
  );
}

interface MoveButtonProps {
  dir: "up" | "down";
  /** False at either end: the button stays, focusable and unavailable, so focus is never lost. */
  able: boolean;
  /** The card's title, which names the button for assistive technology. */
  title: string;
  onMove: (by: -1 | 1) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

function MoveButton({ dir, able, title, onMove, buttonRef }: MoveButtonProps) {
  const words = dir === "up" ? "Move Up" : "Move Down";
  return (
    <Button
      ref={buttonRef}
      size="sm"
      variant="ghost"
      icon={dir}
      aria-label={`${words}, ${title}`}
      aria-disabled={!able || undefined}
      onClick={() => able && onMove(dir === "up" ? -1 : 1)}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-40"
    >
      {words}
    </Button>
  );
}
