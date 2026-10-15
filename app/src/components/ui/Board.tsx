import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./data";

export interface BoardCard {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  owner?: string;
  onClick?: () => void;
}

/**
 * A kanban board: columns of cards. Four across on a desktop, two on a tablet,
 * one on a phone. With `onMove`, cards drag between columns; the card's own
 * detail must offer the same move as buttons, for keyboards and phones.
 */
export function Board({ columns, onMove }: { columns: Array<{ key: string; label: ReactNode; color: string; count?: number; cards: BoardCard[] }>; onMove?: (card: string, from: string, to: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((c) => (
        <div
          key={c.key}
          className={cn("min-w-0 rounded-card border border-border bg-muted p-2.5 transition-colors", over === c.key && "border-ring bg-accent")}
          onDragOver={onMove ? (e) => (e.preventDefault(), setOver(c.key)) : undefined}
          onDragLeave={onMove ? () => setOver((o) => (o === c.key ? null : o)) : undefined}
          onDrop={
            onMove
              ? (e) => {
                  e.preventDefault();
                  setOver(null);
                  const [card, from] = e.dataTransfer.getData("text/plain").split("|");
                  if (card && from !== c.key) onMove(card, from, c.key);
                }
              : undefined
          }
        >
          <h4 className="mb-2.5 flex items-center gap-[7px] text-[11.5px] tracking-[.07em] text-muted-foreground uppercase">
            <i className="size-[7px] flex-none rounded-[2px]" style={{ background: c.color }} />
            {c.label}
            <em className="ml-auto text-[11px] text-subtle-foreground not-italic">{c.count ?? c.cards.length}</em>
          </h4>
          {c.cards.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={t.onClick}
              draggable={!!onMove}
              onDragStart={onMove ? (e) => e.dataTransfer.setData("text/plain", `${t.key}|${c.key}`) : undefined}
              className={cn("mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-2", onMove && "cursor-grab active:cursor-grabbing")}
            >
              <b className="mb-[7px] block text-[12.5px] leading-[1.35] font-semibold">{t.title}</b>
              <span className="flex flex-wrap items-center gap-1.5">
                {t.meta}
                {t.owner && <Avatar name={t.owner} size={21} />}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
