/**
 * @component TrailMenu
 * @group Shell
 * @summary The trail: the last places a person went on this device and the one ahead, each with its glyph and how far it is, to jump straight to one (F29).
 * @use Held open by the app's shell: under NavCapsule on desktop when an arrow or the pin is held, as a sheet on a phone when the pin is held. Items come from the app's trail, the one ahead first, then the place on screen, then back.
 * @avoid Moving between modules (Rail, BottomBar); finding a record (CommandPalette); a list of actions (Menu).
 * @phone A bottom sheet of 44 px rows titled Trail, the place on screen marked Now; a tap goes there and the sheet closes. The phone's Back closes it first.
 * @a11y A menu named Trail of menu items, each read with its place and how far back or ahead it is; arrow keys move, Enter goes, Esc closes and focus returns to the control that opened it.
 * @status stable
 * @example <TrailMenu open={open} onOpenChange={setOpen} items={trail} onGo={(offset) => go(offset)}><NavCapsule ... /></TrailMenu>
 */
import { useRef, type KeyboardEvent, type ReactElement } from "react";
import * as Radix from "@radix-ui/react-popover";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon, type IconName } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";

/** One place on the trail. */
export interface TrailItem {
  /** Where it is from the place on screen: -2 two back, 0 here, 1 ahead. */
  offset: number;
  /** Its name: a record's own name, or the screen's. */
  title: string;
  /** Under the name: the module and screen it is on. */
  sub?: string;
  /** Its glyph, the module's. */
  icon: IconName;
}

export interface TrailMenuProps {
  /** Whether it is showing. */
  open: boolean;
  /** Called to open or close it. */
  onOpenChange: (open: boolean) => void;
  /** The places, the one ahead first, then the place on screen (offset 0), then back. */
  items: TrailItem[];
  /** Go to a place, by its offset; the menu closes. */
  onGo: (offset: number) => void;
  /** On desktop, what it hangs under (the capsule); a phone needs nothing. */
  children?: ReactElement;
  /** Where it mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

const away = (offset: number) => (offset === 0 ? "Now" : offset > 0 ? "Ahead" : `${-offset} Back`);

function Places({ items, onGo, phone }: { items: TrailItem[]; onGo: (offset: number) => void; phone: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  // Arrow keys move through the places, as in any menu; Home and End jump to the ends.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
    if (to === null || !rows.length) return;
    e.preventDefault();
    rows[(to + rows.length) % rows.length]?.focus();
  };
  return (
    <div ref={list} role="menu" aria-label="Trail" onKeyDown={onKeyDown} className="flex flex-col">
      {items.map((it) => {
        const now = it.offset === 0;
        return (
          <button
            key={it.offset}
            type="button"
            role="menuitem"
            aria-current={now ? "page" : undefined}
            data-trail={it.offset}
            onClick={() => onGo(it.offset)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-box px-2 text-left outline-none focus-visible:bg-muted",
              phone ? "min-h-tap py-1.5" : "min-h-10 py-1",
              now ? "bg-accent" : "hover:bg-muted",
            )}
          >
            <span className={cn("flex size-7 flex-none items-center justify-center rounded-ctl", now ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              <Icon name={it.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span data-copy="content" className={cn("block truncate text-sm font-strong", now && "text-accent-foreground")}>
                {it.title}
              </span>
              {it.sub && (
                <span data-copy="content" className={cn("block truncate text-xs", now ? "text-accent-foreground" : "text-subtle-foreground")}>
                  {it.sub}
                </span>
              )}
            </span>
            <span className={cn("flex-none text-2xs font-strong tracking-wide uppercase", now ? "text-accent-foreground" : "text-subtle-foreground")}>{away(it.offset)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TrailMenu({ open, onOpenChange, items, onGo, children, container }: TrailMenuProps) {
  const phone = useIsPhone();
  const go = (offset: number) => {
    onOpenChange(false);
    if (offset !== 0) onGo(offset);
  };

  if (phone) {
    return (
      <>
        {children}
        <Sheet open={open} onClose={() => onOpenChange(false)} title="Trail" container={container} bodyClassName="px-2 pt-1 pb-3">
          <Places items={items} onGo={go} phone />
        </Sheet>
      </>
    );
  }

  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      {children && <Radix.Anchor asChild>{children}</Radix.Anchor>}
      <Radix.Portal container={container ?? undefined}>
        <Radix.Content
          aria-label="Trail"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            // Start on the place one back: the one most often wanted.
            e.preventDefault();
            const target = e.currentTarget as HTMLElement | null;
            (target?.querySelector<HTMLElement>('[data-trail="-1"]') ?? target?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
          }}
          className="z-50 w-76 animate-rise rounded-box border border-border bg-popover p-1.5 text-popover-foreground shadow-3 outline-none"
        >
          <p className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-2xs font-strong tracking-wide text-subtle-foreground uppercase">
            <Icon name="history" />
            Trail
          </p>
          <Places items={items} onGo={go} phone={false} />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
