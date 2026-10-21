/**
 * @component PhoneHeader
 * @group Shell
 * @summary The phone's top: a bar with the pin at the left and search, the bell and the person's avatar at the right, over a title rail with the module's name and its tabs.
 * @use Once, in PhoneShell's header slot. The title is the module's name; the tabs are the module's Tabs. Scrolling the page down slides the title away and keeps the tabs; scrolling up brings it back. `onPinHold` opens the trail when the pin is held, in the installed app (F29).
 * @avoid Desktop (TopBar); a screen's own title (PageHeader carries that inside the page); more than three actions in the bar.
 * @phone The whole point: one line of bar (the pin alone, no word), a large one-line title shortened with an ellipsis when long, the tabs a sideways-scrolling strip; every control 44 px. There is no back button (F29): the phone's own Back goes back, and holding the pin opens the trail.
 * @a11y The pin is a link named "MyCity App, Home". The title is text, not a heading (the screen's PageHeader holds the page's h1); while it is slid away it is hidden from assistive technology too.
 * @status stable
 * @example <PhoneHeader title="Employee Self-Service" homeHref="/home" actions={<><IconButton icon="srch" label="Search" /><IconButton icon="bell" label="Notifications" /></>} tabs={<Tabs ... />} />
 */
import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { useHold } from "../lib/hold";
import { Brand } from "./Brand";
import { useShellScroll } from "./scroll";

export interface PhoneHeaderProps {
  /** The module's name, one line. */
  title?: string;
  /** The module's tab strip (Tabs). */
  tabs?: ReactNode;
  /** The bar's actions, right to left as read: search, the bell, the avatar button. */
  actions?: ReactNode;
  /** Where the pin goes: Home. */
  homeHref: string;
  /** Called with homeHref on a plain tap on the pin. */
  onNavigate?: (href: string) => void;
  /** The pin held (or right clicked): the trail of places, in the installed app (F29). */
  onPinHold?: () => void;
}

const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function PhoneHeader({ title, tabs, actions, homeHref, onNavigate, onPinHold }: PhoneHeaderProps) {
  const { direction, atTop } = useShellScroll();
  const tucked = direction === "down" && !atTop;
  const hold = useHold({ onHold: () => onPinHold?.() });
  return (
    <header data-phone-header="" className="flex-none border-b border-border bg-background pt-safe">
      <div className="flex h-14 items-center gap-1 px-2">
        <a
          href={homeHref}
          aria-label="MyCity App, Home"
          aria-haspopup={onPinHold ? "menu" : undefined}
          onClick={(e) => {
            if (onNavigate && plain(e)) {
              e.preventDefault();
              onNavigate(homeHref);
            }
          }}
          {...(onPinHold ? hold : {})}
          className="no-callout flex size-tap items-center justify-center rounded-ctl select-none"
        >
          <Brand label="MyCity App, Home" />
        </a>
        <span className="flex-1" />
        {actions != null && <div className="flex flex-none items-center gap-0.5">{actions}</div>}
      </div>
      {title && (
        <div
          aria-hidden={tucked || undefined}
          className={cn("overflow-hidden px-4 transition-all duration-(--dur) ease-out", tucked ? "max-h-0 opacity-0" : "max-h-12 opacity-100")}
        >
          <div data-ui="title" className="truncate pb-1 text-2xl leading-tight font-strong tracking-tight">
            {title}
          </div>
        </div>
      )}
      {tabs != null && <div className="px-2">{tabs}</div>}
    </header>
  );
}
