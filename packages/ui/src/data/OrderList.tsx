/**
 * @component OrderList
 * @group Data
 * @summary Rows a person keeps in an order they set: dragged by their handle on desktop, and moved with Move Up and Move Down in each row's menu on both shells.
 * @use A short ordered set a person arranges: a course's items, a form's steps, a route's stops (up to about 40 rows).
 * @avoid A server-paged list of records (DataView); stages a card moves between (Kanban); picking and ordering cards for a row (CardPicker); dragging as the only way to move a row.
 * @phone No dragging (F19): each row's menu opens as an action sheet with Move Up and Move Down beside the row's own actions; every menu button is a 44 px target.
 * @a11y An ordered list named by `label`. Move Up and Move Down are real menu items named for their row, so a keyboard and a screen reader reorder without dragging; a polite status reads a row's new place. While a move is on its way the list says aria-busy and every menu stays focusable but does not open (F26).
 * @status beta
 * @example <OrderList label="Course Items" items={items.map((i) => ({ key: i.id, name: i.title, content: <ItemRow item={i} />, menu: [{ label: "Edit Item", icon: "edit", onSelect: () => edit(i) }] }))} onMove={(key, to) => reorder(key, to)} />
 */
import { useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { IconButton } from "../actions/Button";
import { isThenable, whenSettled } from "../actions/press";
import { Icon } from "../icons/Icon";
import { Menu, type MenuItem } from "../overlay/Menu";

/** One row. */
export interface OrderListItem {
  /** Its own key, the record's id. */
  key: string;
  /** The row's name in words, for its menu's name and the moves ("Move Handbook Up"). */
  name: string;
  /** What the row shows: its glyph, title and figures. */
  content: ReactNode;
  /** The row's own actions (Edit Item, Remove Item), before Move Up and Move Down. */
  menu?: MenuItem[];
}

export interface OrderListProps {
  /** The rows, in their order. */
  items: OrderListItem[];
  /** Names the list for assistive technology ("Course Items"). */
  label: string;
  /** Moves a row to a new place (0 is the top). Hand back the work (a promise) and the list waits until it settles. Without it the order is fixed and nothing drags. */
  onMove?: (key: string, to: number) => unknown;
  /** What shows when there are no rows. */
  empty?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A menu button held while a move is on its way: named as busy, still focusable, and it does not open (F26). */
const held = (busy: boolean) =>
  busy
    ? {
        "aria-busy": true as const,
        "aria-disabled": true as const,
        // The menu opens on pointer down and on Enter, Space or the arrows; a refused default keeps it shut.
        onPointerDown: (e: PointerEvent) => e.preventDefault(),
        onKeyDown: (e: { preventDefault: () => void }) => e.preventDefault(),
      }
    : {};

export function OrderList({ items, label, onMove, empty, className }: OrderListProps) {
  const phone = useIsPhone();
  // The move on its way. The ref refuses a second one before React draws the busy state.
  const moving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const drag = !phone && Boolean(onMove) && !busy;

  /** Moves a row once; work handed back holds the list until it settles. */
  const move = (key: string, to: number) => {
    const from = items.findIndex((i) => i.key === key);
    if (!onMove || moving.current || from < 0 || to < 0 || to >= items.length || to === from) return;
    setSaid(`${items[from]!.name} moved to place ${to + 1} of ${items.length}`);
    const work = onMove(key, to);
    if (!isThenable(work)) return;
    moving.current = true;
    setBusy(true);
    whenSettled(work, () => {
      moving.current = false;
      setBusy(false);
    });
  };

  const menuOf = (item: OrderListItem, i: number): MenuItem[] => {
    const moves: MenuItem[] = [];
    if (onMove && i > 0) moves.push({ label: "Move Up", icon: "up", onSelect: () => move(item.key, i - 1) });
    if (onMove && i < items.length - 1) moves.push({ label: "Move Down", icon: "down", onSelect: () => move(item.key, i + 1) });
    const own = item.menu ?? [];
    return own.length && moves.length ? [...own, "sep", ...moves] : [...own, ...moves];
  };

  if (!items.length) return <div className={className}>{empty}</div>;

  return (
    <div className={className}>
      <ol aria-label={label} aria-busy={busy || undefined} className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, i) => {
          const menu = menuOf(item, i);
          return (
            <li
              key={item.key}
              draggable={drag}
              onDragStart={drag ? (e: DragEvent) => e.dataTransfer.setData("text/plain", item.key) : undefined}
              onDragOver={drag ? (e: DragEvent) => (e.preventDefault(), setOver(i)) : undefined}
              onDragLeave={drag ? () => setOver((o) => (o === i ? null : o)) : undefined}
              onDragEnd={drag ? () => setOver(null) : undefined}
              onDrop={
                drag
                  ? (e: DragEvent) => {
                      e.preventDefault();
                      setOver(null);
                      const key = e.dataTransfer.getData("text/plain");
                      if (key) move(key, i);
                    }
                  : undefined
              }
              className={cn(
                "flex items-center gap-2.5 rounded-box border border-border bg-card px-3 py-2.5 transition-colors",
                over === i && "border-ring bg-accent",
                busy && "opacity-70",
              )}
            >
              {onMove && !phone && (
                <span aria-hidden="true" className={cn("flex-none text-subtle-foreground", drag && "cursor-grab")}>
                  <Icon name="drag" size="s" />
                </span>
              )}
              <div className="min-w-0 flex-1">{item.content}</div>
              {menu.length > 0 && (
                <Menu
                  label={item.name}
                  items={menu}
                  trigger={(p) => <IconButton {...p} {...held(busy)} icon="dots" label={`Actions for ${item.name}`} className="flex-none" />}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div role="status" className="sr-only">
        {said}
      </div>
    </div>
  );
}
