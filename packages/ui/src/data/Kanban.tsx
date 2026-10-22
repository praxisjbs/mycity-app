/**
 * @component Kanban
 * @group Data
 * @summary A board of stages: columns of cards on desktop, and on a phone a stage switcher over the cards of one stage (F19).
 * @use A pipeline a person moves records along: partnerships, recruitment, tasks, requisitions.
 * @avoid A list that is not staged (use DataView); dragging as the only way to move a card; more than six stages.
 * @phone No dragging at all (F19): chips with counts choose the stage, and a card's Move To opens the other stages as an action sheet.
 * @a11y Each column is a named group; Move To is a real menu (with Move Up and Move Down within the stage), so a card can be moved and reordered by keyboard and by screen reader, never only by dragging.
 * @status stable
 * @exports KanbanCardBody
 * @example <Kanban columns={stages} onMove={(card, from, to) => move(card, to)} onOpen={openRecord} empty={<EmptyState title="No Tasks Yet" />} />
 */
import { useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { Avatar } from "../display/Avatar";
import { Button } from "../actions/Button";
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
   * either way, because a keyboard and a phone cannot drag (F19).
   */
  onMove?: (card: string, from: string, to: string, before: string | null) => void;
  /**
   * The stages keep an order the person sets: Move Up and Move Down in the menu, and a drop onto
   * a card places it above that card. Without it a card only moves between stages.
   */
  reorder?: boolean;
  /** What shows in place of the board when no stage holds a card (an EmptyState). */
  empty?: ReactNode;
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

export function Kanban({ columns, onOpen, onMove, reorder = false, empty, className }: KanbanProps) {
  const phone = useIsPhone();
  const [stage, setStage] = useState(columns[0]?.key ?? "");
  const [over, setOver] = useState<string | null>(null);

  // A stage that disappears (a filter changed) would otherwise leave the phone blank.
  useEffect(() => {
    if (columns.length > 0 && !columns.some((c) => c.key === stage)) setStage(columns[0]!.key);
  }, [columns, stage]);

  const bare = empty !== undefined && columns.every((c) => c.cards.length === 0 && !c.count);

  const moveItems = (card: string, from: string): MenuItem[] => {
    const cards = columns.find((c) => c.key === from)?.cards ?? [];
    const i = cards.findIndex((c) => c.key === card);
    const within: MenuItem[] = [];
    if (reorder && i > 0) within.push({ label: "Move Up", icon: "up", onSelect: () => onMove?.(card, from, from, cards[i - 1]!.key) });
    if (reorder && i >= 0 && i < cards.length - 1) within.push({ label: "Move Down", icon: "down", onSelect: () => onMove?.(card, from, from, cards[i + 2]?.key ?? null) });
    const across: MenuItem[] = columns.filter((c) => c.key !== from).map((c) => ({ label: `Move to ${c.label}`, icon: "right" as const, onSelect: () => onMove?.(card, from, c.key, null) }));
    return within.length ? [...within, "sep", ...across] : across;
  };
  /** A drag's card and stage, as onDragStart wrote them. */
  const dragged = (e: DragEvent) => {
    const [card, from] = e.dataTransfer.getData("text/plain").split("|");
    return card && from ? { card, from } : null;
  };

  if (bare) return <div className={className}>{empty}</div>;

  if (phone) {
    const current = columns.find((c) => c.key === stage) ?? columns[0];
    return (
      <div className={className}>
        <Chips
          label="Stage"
          value={stage}
          onChange={setStage}
          options={columns.map((c) => ({ value: c.key, label: c.label, count: c.count ?? c.cards.length }))}
        />
        {current && (
          <ul {...content} aria-label={current.label} className="m-0 flex list-none flex-col gap-2 p-0">
            {current.cards.map((card) => (
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
                        <button {...p} type="button" className="flex min-h-tap items-center gap-1.5 text-xs font-semibold text-accent-foreground">
                          <Icon name="sort" size="s" />
                          Move To
                        </button>
                      )}
                    />
                  </span>
                )}
              </li>
            ))}
            {current.cards.length === 0 && <li className="rounded-box border border-dashed border-input px-3 py-6 text-center text-xs text-subtle-foreground">Nothing in this stage</li>}
          </ul>
        )}
        {current && <More column={current} />}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4", className)}>
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
                  if (d && (reorder || d.from !== column.key)) onMove(d.card, d.from, column.key, null);
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
            {column.cards.map((card) => (
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
                        if (reorder) onMove(d.card, d.from, column.key, card.key);
                        else if (d.from !== column.key) onMove(d.card, d.from, column.key, null);
                      }
                    : undefined
                }
              >
                <div
                  draggable={Boolean(onMove)}
                  onDragStart={onMove ? (e: DragEvent) => e.dataTransfer.setData("text/plain", `${card.key}|${column.key}`) : undefined}
                  className={cn("rounded-box border border-border bg-card p-2.5 transition hover:-translate-y-0.5 hover:shadow-2", onMove && "cursor-grab active:cursor-grabbing")}
                >
                  <button type="button" onClick={() => onOpen?.(card.key, column.key)} className={cn("w-full text-left", onOpen && "stretch-link")}>
                    <KanbanCardBody card={card} />
                  </button>
                  {onMove && (
                    <span className="relative z-10 mt-2 flex justify-end">
                      <Menu label="Move To" items={moveItems(card.key, column.key)} trigger={(p) => <button {...p} type="button" aria-label={`Move ${card.owner ?? "card"}`} className="text-subtle-foreground hover:text-foreground"><Icon name="dots" size="s" /></button>} />
                    </span>
                  )}
                </div>
              </li>
            ))}
            {column.cards.length === 0 && <li className="rounded-box border border-dashed border-input px-3 py-4 text-center text-2xs text-subtle-foreground">Nothing here</li>}
          </ul>
          <More column={column} />
        </section>
      ))}
    </div>
  );
}
