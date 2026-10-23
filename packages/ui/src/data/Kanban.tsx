/**
 * @component Kanban
 * @group Data
 * @summary A board of stages: columns of cards on desktop, and on a phone a stage switcher over the cards of one stage (F19).
 * @use A pipeline a person moves records along: partnerships, recruitment, tasks, requisitions.
 * @avoid A list that is not staged (use DataView); dragging as the only way to move a card; more than six stages.
 * @phone No dragging at all (F19): chips with counts choose the stage, and a card's Move To opens the other stages as an action sheet.
 * @a11y Each column is a named group; Move To is a real menu (with Move Up and Move Down within the stage), so a card can be moved and reordered by keyboard and by screen reader, never only by dragging. A card whose move is on its way says so (aria-busy) and its Move To stays focusable but does not open (F26).
 * @status stable
 * @exports KanbanCardBody
 * @example <Kanban columns={stages} onMove={(card, from, to) => move(card, to)} onOpen={openRecord} empty={<EmptyState title="No Tasks Yet" />} />
 */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { Avatar } from "../display/Avatar";
import { Skeleton } from "../display/Skeleton";
import { Button } from "../actions/Button";
import { isThenable, whenSettled } from "../actions/press";
import { Chips } from "../navigation/Chips";
import { Icon } from "../icons/Icon";
import { Menu, type MenuItem } from "../overlay/Menu";
import type { Series } from "../charts/lazy";
import { seriesInk } from "../charts/lazy";

/** One card on the board. */
export interface KanbanCard {
  /** Its own key, the record's id. */
  key: string;
  /** The record's own words: a partner's name, a vacancy, a task. */
  title: ReactNode;
  /** What sits under the title: pills, an amount, a date. */
  meta?: ReactNode;
  /** Whose it is; their initials show as an avatar. */
  owner?: string;
}

/** One stage. */
export interface KanbanColumn {
  /** The stage's key, as the server knows it. */
  key: string;
  /** Its name, Title Case, at most 3 words. */
  label: string;
  /** How many records are in the stage, from the server; the cards' own count otherwise. */
  count?: number;
  /** Which of the six series marks it. */
  series?: Series;
  /** The stage's cards, in the order the server returned them. */
  cards: KanbanCard[];
  /**
   * Loads the stage's next page of cards, when the server has more than it sent: a Load More
   * button under the cards that spins until the returned work settles.
   */
  onMore?: () => unknown;
}

export interface KanbanProps {
  /** The stages, left to right. */
  columns: KanbanColumn[];
  /** Opens a card's record. */
  onOpen?: (card: string, column: string) => void;
  /**
   * Moves a card to another stage, or within its own. `before` is the card it now sits above
   * (null: the foot of the stage). Without it the board is read only. On desktop a card can
   * also be dragged onto a stage or onto a card; Move To (with Move Up and Move Down) exists
   * either way, because a keyboard and a phone cannot drag (F19). Hand back the work (a promise)
   * and the card is held until it settles: its Move To spins and does not open, and it is
   * neither dragged nor dropped again, so a quick second press never moves it twice (F26).
   */
  onMove?: (card: string, from: string, to: string, before: string | null) => unknown;
  /**
   * The stages keep an order the person sets: Move Up and Move Down in the menu, and a drop onto
   * a card places it above that card. Without it a card only moves between stages.
   */
  reorder?: boolean;
  /** What shows in place of the board when no stage holds a card (an EmptyState). */
  empty?: ReactNode;
  /**
   * The stages' cards are still on their way: an empty stage shows a placeholder rather than
   * saying it is empty, and `empty` waits, so a board that is loading never reads as one with nothing on it.
   */
  loading?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A card's inside, so a column and the phone list draw the same card. */
export interface KanbanCardBodyProps {
  /** The card. */
  card: KanbanCard;
}

export function KanbanCardBody({ card }: KanbanCardBodyProps) {
  return (
    <>
      <b className="mb-1.5 block text-xs leading-snug font-semibold wrap-any">{card.title}</b>
      {(card.meta != null || card.owner) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {card.meta}
          {card.owner && <Avatar name={card.owner} size={21} />}
        </span>
      )}
    </>
  );
}

/** Load More under a stage's cards, when the server holds more of them. */
function More({ column }: { column: KanbanColumn }) {
  if (!column.onMore) return null;
  return (
    <Button size="sm" block icon="down" onClick={() => column.onMore?.()} className="mt-2">
      Load More
    </Button>
  );
}

/** The spinner a held card's Move To shows in place of its glyph. */
const Spin = () => <LoaderCircle aria-hidden="true" className="size-4 flex-none animate-spin" />;

/** A held card's Move To: named as busy, still focusable, and it does not open (F26). */
const held = (busy: boolean) =>
  busy
    ? {
        "aria-busy": true as const,
        "aria-disabled": true as const,
        // The menu opens on pointer down and on Enter, Space or the arrows; a refused default keeps it shut.
        onPointerDown: (e: PointerEvent) => e.preventDefault(),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key !== "Tab") e.preventDefault();
        },
      }
    : {};

/** Where an empty stage's cards will be, while the board loads. */
function Placeholder() {
  return (
    <li aria-hidden="true">
      <Skeleton shape="block" className="h-16" />
    </li>
  );
}

export function Kanban({ columns, onOpen, onMove, reorder = false, empty, loading = false, className }: KanbanProps) {
  const phone = useIsPhone();
  const [stage, setStage] = useState(columns[0]?.key ?? "");
  const [over, setOver] = useState<string | null>(null);
  // The cards whose move is on its way. The ref refuses a second press before React draws the spinner.
  const moving = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  // A stage that disappears (a filter changed) would otherwise leave the phone blank.
  useEffect(() => {
    if (columns.length > 0 && !columns.some((c) => c.key === stage)) setStage(columns[0]!.key);
  }, [columns, stage]);

  const bare = !loading && empty !== undefined && columns.every((c) => c.cards.length === 0 && !c.count);

  /** Moves a card once: work handed back holds it until it settles, either way. */
  const move = (card: string, from: string, to: string, before: string | null) => {
    if (!onMove || moving.current.has(card)) return;
    const work = onMove(card, from, to, before);
    if (!isThenable(work)) return;
    moving.current.add(card);
    setBusy(new Set(moving.current));
    whenSettled(work, () => {
      moving.current.delete(card);
      setBusy(new Set(moving.current));
    });
  };

  const moveItems = (card: string, from: string): MenuItem[] => {
    const cards = columns.find((c) => c.key === from)?.cards ?? [];
    const i = cards.findIndex((c) => c.key === card);
    const within: MenuItem[] = [];
    if (reorder && i > 0) within.push({ label: "Move Up", icon: "up", onSelect: () => move(card, from, from, cards[i - 1]!.key) });
    if (reorder && i >= 0 && i < cards.length - 1) within.push({ label: "Move Down", icon: "down", onSelect: () => move(card, from, from, cards[i + 2]?.key ?? null) });
    const across: MenuItem[] = columns.filter((c) => c.key !== from).map((c) => ({ label: `Move to ${c.label}`, icon: "right" as const, onSelect: () => move(card, from, c.key, null) }));
    return within.length ? [...within, "sep", ...across] : across;
  };
  /** A drag's card and stage, as onDragStart wrote them; nothing for a card still moving. */
  const dragged = (e: DragEvent) => {
    const [card, from] = e.dataTransfer.getData("text/plain").split("|");
    return card && from && !moving.current.has(card) ? { card, from } : null;
  };

  if (bare) return <div className={className}>{empty}</div>;

  if (phone) {
    const current = columns.find((c) => c.key === stage) ?? columns[0];
    return (
      <div className={className} aria-busy={loading || undefined}>
        <Chips
          label="Stage"
          value={stage}
          onChange={setStage}
          options={columns.map((c) => ({ value: c.key, label: c.label, count: c.count ?? c.cards.length }))}
        />
        {current && (
          <ul {...content} aria-label={current.label} className="m-0 flex list-none flex-col gap-2 p-0">
            {current.cards.map((card) => {
              const wait = busy.has(card.key);
              return (
                <li key={card.key} className="relative rounded-box border border-border bg-card p-2.5">
                  <button type="button" onClick={() => onOpen?.(card.key, current.key)} className={cn("w-full text-left", onOpen && "stretch-link")}>
                    <KanbanCardBody card={card} />
                  </button>
                  {onMove && (
                    <span className="relative z-10 mt-2 flex">
                      <Menu
                        label="Move To"
                        items={moveItems(card.key, current.key)}
                        trigger={(p) => (
                          <button {...p} {...held(wait)} onClick={wait ? undefined : p.onClick} type="button" className="flex min-h-tap items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                            {wait ? <Spin /> : <Icon name="sort" size="s" />}
                            Move To
                          </button>
                        )}
                      />
                    </span>
                  )}
                </li>
              );
            })}
            {current.cards.length === 0 &&
              (loading ? <Placeholder /> : <li className="rounded-box border border-dashed border-input px-3 py-6 text-center text-xs text-subtle-foreground">Nothing in this stage</li>)}
          </ul>
        )}
        {current && <More column={current} />}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4", className)} aria-busy={loading || undefined}>
      {columns.map((column) => (
        <section
          key={column.key}
          aria-label={column.label}
          className={cn("min-w-0 rounded-card border border-border bg-muted p-2.5 transition-colors", over === column.key && "border-ring bg-accent")}
          onDragOver={onMove ? (e: DragEvent) => (e.preventDefault(), setOver(column.key)) : undefined}
          onDragLeave={onMove ? () => setOver((o) => (o === column.key ? null : o)) : undefined}
          onDrop={
            onMove
              ? (e: DragEvent) => {
                  e.preventDefault();
                  setOver(null);
                  const d = dragged(e);
                  if (d && (reorder || d.from !== column.key)) move(d.card, d.from, column.key, null);
                }
              : undefined
          }
        >
          {/* The board sits straight under a screen's own title, so its stages are that screen's second level. */}
          <h2 className="mb-2.5 flex items-center gap-2 text-2xs tracking-caps text-muted-foreground uppercase">
            <span aria-hidden="true" className="size-2 flex-none rounded-sm bg-(--stage-ink)" style={{ "--stage-ink": seriesInk(column.series ?? 1) } as CSSProperties} />
            {column.label}
            <em className="ml-auto text-2xs text-subtle-foreground not-italic tabular-nums">{column.count ?? column.cards.length}</em>
          </h2>
          <ul {...content} className="m-0 flex list-none flex-col gap-2 p-0">
            {column.cards.map((card) => {
              const wait = busy.has(card.key);
              return (
                <li
                  key={card.key}
                  className="relative"
                  onDrop={
                    onMove
                      ? (e: DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOver(null);
                          const d = dragged(e);
                          if (!d || d.card === card.key) return;
                          if (reorder) move(d.card, d.from, column.key, card.key);
                          else if (d.from !== column.key) move(d.card, d.from, column.key, null);
                        }
                      : undefined
                  }
                >
                  <div
                    draggable={Boolean(onMove) && !wait}
                    onDragStart={onMove ? (e: DragEvent) => e.dataTransfer.setData("text/plain", `${card.key}|${column.key}`) : undefined}
                    className={cn("rounded-box border border-border bg-card p-2.5 transition hover:-translate-y-0.5 hover:shadow-2", onMove && !wait && "cursor-grab active:cursor-grabbing")}
                  >
                    <button type="button" onClick={() => onOpen?.(card.key, column.key)} className={cn("w-full text-left", onOpen && "stretch-link")}>
                      <KanbanCardBody card={card} />
                    </button>
                    {onMove && (
                      <span className="relative z-10 mt-2 flex justify-end">
                        <Menu
                          label="Move To"
                          items={moveItems(card.key, column.key)}
                          trigger={(p) => (
                            <button {...p} {...held(wait)} type="button" aria-label={`Move ${card.owner ?? "card"}`} className="text-subtle-foreground hover:text-foreground">
                              {wait ? <Spin /> : <Icon name="dots" size="s" />}
                            </button>
                          )}
                        />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {column.cards.length === 0 &&
              (loading ? <Placeholder /> : <li className="rounded-box border border-dashed border-input px-3 py-4 text-center text-2xs text-subtle-foreground">Nothing here</li>)}
          </ul>
          <More column={column} />
        </section>
      ))}
    </div>
  );
}
