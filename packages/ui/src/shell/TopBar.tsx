/**
 * @component TopBar
 * @group Shell
 * @summary The desktop top bar: the rail toggle, the search button that opens the command palette, and the person's quick actions (clock, bell).
 * @use Once, in DesktopShell's top bar slot. SearchButton is its search control; the actions are IconButtons and the clock button.
 * @avoid A phone (PhoneHeader is the phone's top bar); page actions (PageHeader); more than four actions.
 * @phone Never shown on a phone; its controls are 44 px targets so the gallery's phone view passes.
 * @a11y A banner landmark when it is the page's top bar; SearchButton names the shortcut (aria-keyshortcuts) and shows it as keycaps.
 * @status stable
 * @exports SearchButton
 * @example <TopBar start={<IconButton icon="panel" label="Collapse Menu" />} search={<SearchButton onClick={openPalette} />} actions={<IconButton icon="bell" label="Notifications" />} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Kbd } from "../display/Kbd";

export interface TopBarProps {
  /** What sits first: the rail's collapse toggle. */
  start?: ReactNode;
  /** The SearchButton. */
  search?: ReactNode;
  /** The quick actions at the right: clock in or out, the bell. */
  actions?: ReactNode;
}

export function TopBar({ start, search, actions }: TopBarProps) {
  return (
    <header className="flex min-h-14.5 flex-none items-center gap-2.5 border-b border-border bg-background px-4">
      {start}
      <div className="flex min-w-0 flex-1">{search}</div>
      {actions != null && <div className="flex flex-none items-center gap-1.5">{actions}</div>}
    </header>
  );
}

export interface SearchButtonProps {
  /** Opens the command palette. */
  onClick: () => void;
  /** The words in the box; Search Anything unless set. */
  label?: string;
  /** Show the ⌘K (or Ctrl K) keycaps; default true. */
  shortcut?: boolean;
  /** Layout classes only (width). */
  className?: string;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The search box that is a button: it opens the command palette, as ⌘K does. */
export function SearchButton({ onClick, label = "Search Anything", shortcut = true, className }: SearchButtonProps) {
  const mac = isMac();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={shortcut ? "Meta+K Control+K" : undefined}
      className={cn(
        "flex h-9 w-full max-w-95 min-w-11 items-center gap-2 rounded-full border border-border bg-muted px-3 text-sm text-subtle-foreground transition-colors hover:border-input phone:h-tap",
        className,
      )}
    >
      <Icon name="srch" />
      <span data-ui="button" className="truncate">
        {label}
      </span>
      {shortcut && <Kbd className="ml-auto" keys={mac ? ["⌘", "K"] : ["Ctrl", "K"]} />}
    </button>
  );
}
