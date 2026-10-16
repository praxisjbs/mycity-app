/**
 * @component BottomBar
 * @group Shell
 * @summary The phone's bottom bar: Home, Workspace, Community, Self-Service and More, each an icon with one word, within thumb reach (F16).
 * @use Once, in PhoneShell's bottom bar slot. The same five for everyone; More is a button that opens MoreSheet, the others are links.
 * @avoid Desktop (the Rail; the screen gates fail a bottom bar on desktop); more than five items; a second row.
 * @phone The whole point: fixed at the foot, above the home indicator, each item at least 52 px tall; a count shows on the icon.
 * @a11y The Main navigation landmark; the current item is aria-current="page"; More says it opens a dialog (aria-haspopup) and whether it is open.
 * @status stable
 * @example <BottomBar current="home" onNavigate={navigate} items={[{ key: "home", label: "Home", icon: "home", href: "/home" }, { key: "more", label: "More", icon: "grid", onSelect: openMore }]} />
 */
import type { MouseEvent } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { CountBadge } from "../display/CountBadge";

/** One place in the bottom bar: a link (href) or a button (onSelect, for More). */
export interface BottomBarItem {
  /** Its key; the module key for a link. */
  key: string;
  /** One word. */
  label: string;
  /** Its glyph. */
  icon: IconName;
  /** Where it goes. */
  href?: string;
  /** What it does instead of going somewhere (More). */
  onSelect?: () => void;
  /** Things waiting behind it; nothing is drawn for 0. */
  count?: number;
  /** For a button: whether what it opens is open. */
  expanded?: boolean;
}

export interface BottomBarProps {
  /** The five places, left to right. */
  items: BottomBarItem[];
  /** The key of the place in view. */
  current: string | null;
  /** Called with an item's href on a plain tap. */
  onNavigate?: (href: string) => void;
  /** Names the navigation landmark; Main unless set. */
  label?: string;
}

const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const ITEM = "relative flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5 rounded-box px-0.5 py-1.5 text-2xs font-semibold no-underline";

export function BottomBar({ items, current, onNavigate, label = "Main" }: BottomBarProps) {
  return (
    <nav data-ui="phone-nav" aria-label={label} className="on-dark flex flex-none border-t border-sidebar-border bg-sidebar px-1 pt-1 pb-safe text-sidebar-foreground">
      {items.map((item) => {
        const on = item.key === current;
        const body = (
          <>
            <span className="relative">
              <Icon name={item.icon} size="l" />
              {!!item.count && <CountBadge count={item.count} className="absolute -top-1.5 -right-2.5" />}
            </span>
            <span data-ui="nav-label">{item.label}</span>
          </>
        );
        const look = cn(ITEM, on ? "text-primary" : "text-sidebar-muted");
        if (item.href) {
          const href = item.href;
          return (
            <a
              key={item.key}
              href={href}
              aria-current={on ? "page" : undefined}
              className={look}
              onClick={(e) => {
                if (onNavigate && plain(e)) {
                  e.preventDefault();
                  onNavigate(href);
                }
              }}
            >
              {body}
            </a>
          );
        }
        return (
          <button key={item.key} type="button" onClick={item.onSelect} aria-haspopup="dialog" aria-expanded={!!item.expanded} className={look}>
            {body}
          </button>
        );
      })}
    </nav>
  );
}
