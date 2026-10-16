/**
 * @component Kanban
 * @group Data
 * @summary A board of stages: columns of cards on desktop, and on a phone a stage switcher over the cards of one stage (F19).
 * @use A pipeline a person moves records along: partnerships, recruitment, tasks, requisitions.
 * @avoid A list that is not staged (use DataView); dragging as the only way to move a card; more than six stages.
 * @phone No dragging at all (F19): chips with counts choose the stage, and a card's Move To opens the other stages as an action sheet.
 * @a11y Each column is a named group; Move To is a real menu, so a card can be moved by keyboard and by screen reader, never only by dragging.
 * @status stable
 * @exports KanbanCardBody
 * @example <Kanban columns={stages} onMove={(card, from, to) => move(card, to)} onOpen={openRecord} />
 */
import { useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { Avatar } from "../display/Avatar";
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
}

export interface KanbanProps {
  /** The stages, left to right. */
  columns: KanbanColumn[];
  /** Opens a card's record. */
  onOpen?: (card: string, column: string) => void;
  /**
   * Moves a card to another stage. Without it the board is read only. On
   * desktop a card can also be dragged; Move To exists either way, because a
   * keyboard and a phone cannot drag (F19).
   */
  onMove?: (card: string, from: string, to: string) => void;
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

export function Kanban({ columns, onOpen, onMove, className }: KanbanProps) {
  const phone = useIsPhone();
  const [stage, setStage] = useState(columns[0]?.key ?? "");
  const [over, setOver] = useState<string | null>(null);

  // A stage that disappears (a filter changed) would otherwise leave the phone blank.
  useEffect(() => {
    if (columns.length > 0 && !columns.some((c) => c.key === stage)) setStage(columns[0]!.key);
  }, [columns, stage]);

  const moveItems = (card: string, from: string): MenuItem[] =>
    columns.filter((c) => c.key !== from).map((c) => ({ label: `Move to ${c.label}`, icon: "right" as const, onSelect: () => onMove?.(card, from, c.key) }));

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
                  const [card, from] = e.dataTransfer.getData("text/plain").split("|");
                  if (card && from && from !== column.key) onMove(card, from, column.key);
                }
              : undefined
          }
        >
          <h3 className="mb-2.5 flex items-center gap-2 text-2xs tracking-caps text-muted-foreground uppercase">
            <span aria-hidden="true" className="size-2 flex-none rounded-sm bg-(--stage-ink)" style={{ "--stage-ink": seriesInk(column.series ?? 1) } as CSSProperties} />
            {column.label}
            <em className="ml-auto text-2xs text-subtle-foreground not-italic tabular-nums">{column.count ?? column.cards.length}</em>
          </h3>
          <ul {...content} className="m-0 flex list-none flex-col gap-2 p-0">
            {column.cards.map((card) => (
              <li key={card.key} className="relative">
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
          </ul>
        </section>
      ))}
    </div>
  );
}
