/**
 * @component Rail
 * @group Shell
 * @summary The desktop navigation: the pin and name, the modules the person may open grouped by area with their counts, and the person's own menu at the foot.
 * @use Once, in DesktopShell's rail slot. Items come from the module catalogue filtered by the person's grants; it collapses to icons (66 px) when the person asks, remembered per device by the app.
 * @avoid A phone (BottomBar and MoreSheet are the phone's navigation, gate 11); tabs inside a module (Tabs); actions (the top bar).
 * @phone Never shown on a phone; its items are still 44 px targets so the gallery's phone view passes.
 * @a11y The whole rail is one navigation landmark named by `label` (the pin, the modules and the account); the current module is aria-current="page"; collapsed, each item keeps its name for screen readers and as a hover title. The account button opens a Menu.
 * @status stable
 * @example <Rail items={items} current="people" onNavigate={navigate} account={{ name: "Cynthia Osakunih", subtitle: "Operations Manager", menu }} />
 */
import { forwardRef, type HTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Avatar } from "../display/Avatar";
import { Menu, type MenuItem } from "../overlay/Menu";
import { Tooltip } from "../overlay/Tooltip";
import { Brand } from "./Brand";

/** One module in the rail. */
export interface RailItem {
  /** The module key (permission key). */
  key: string;
  /** Its name, as in the catalogue. */
  label: string;
  /** Its glyph. */
  icon: IconName;
  /** Its address (the one URL shape). */
  href: string;
  /** The area heading it sits under (Work, People, Business, System); none for the first items. */
  group?: string;
  /** Things waiting in it; nothing is drawn for 0. */
  count?: number;
}

/** The person at the foot of the rail, and what their menu holds. */
export interface RailAccount {
  /** Their name. */
  name: string;
  /** Their job title. */
  subtitle?: string;
  /** Their photo, if they have one. */
  photo?: string | null;
  /** The menu: My Profile, Theme, Density, Install App, Sign Out. */
  menu: MenuItem[];
}

export interface RailProps {
  /** The modules, in rail order. */
  items: RailItem[];
  /** The module in view, by key. */
  current: string | null;
  /** Icons only (66 px). */
  collapsed?: boolean;
  /** Called with an item's href on a plain click; the link still opens in a new tab with a modifier. */
  onNavigate?: (href: string) => void;
  /** The person and their menu, at the foot. */
  account?: RailAccount;
  /** The name beside the pin; MyCity App unless set. */
  brandName?: string;
  /** A last line under the account (Engineered by JBS Praxis). */
  foot?: ReactNode;
  /** Names the navigation landmark; Modules unless set. */
  label?: string;
}

const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;


/** A collapsed rail names its links in our tooltip, to the right; an open rail shows the words. */
const Tip = forwardRef<HTMLElement, { label: string | null; children: ReactElement } & HTMLAttributes<HTMLElement>>(function Tip({ label, children, ...rest }, ref) {
  return label ? (
    <Tooltip label={label} side="right" {...rest} ref={ref}>
      {children}
    </Tooltip>
  ) : (
    <Slot {...rest} ref={ref}>
      {children}
    </Slot>
  );
});
export function Rail({ items, current, collapsed = false, onNavigate, account, brandName = "MyCity App", foot, label = "Modules" }: RailProps) {
  let lastGroup: string | undefined;
  return (
    <nav
      data-ui="desktop-nav"
      aria-label={label}
      className={cn(
        "on-dark flex min-h-0 flex-none flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-(--dur)",
        collapsed ? "w-16.5" : "w-62",
      )}
    >
      <div className="flex min-h-14.5 flex-none items-center gap-2.5 px-4.5 pt-4 pb-3">
        <Brand tone="on-dark" size="m" name={collapsed ? undefined : brandName} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pt-0.5 pb-2.5">
        {items.map((item) => {
          const head = item.group && item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          const on = item.key === current;
          return (
            <div key={item.key} className="contents">
              {head && (
                <div aria-hidden={collapsed || undefined} className={cn("px-2 pt-3.5 pb-1.5 text-2xs font-strong tracking-widest whitespace-nowrap text-sidebar-muted uppercase", collapsed && "invisible")}>
                  {head}
                </div>
              )}
              <Tip label={collapsed ? item.label : null}>
                <a
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  onClick={(e) => {
                    if (onNavigate && plain(e)) {
                      e.preventDefault();
                      onNavigate(item.href);
                    }
                  }}
                  className={cn(
                    "flex min-h-9 items-center gap-3 rounded-ctl px-2.5 py-2 text-base font-medium whitespace-nowrap no-underline transition-colors phone:min-h-tap",
                    on ? "bg-sidebar-primary font-strong text-sidebar-primary-foreground" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
                  )}
                >
                  <Icon name={item.icon} size="m" />
                  <span data-ui="nav-label" className={cn(collapsed && "sr-only")}>
                    {item.label}
                  </span>
                  {!!item.count && (
                    <span className={cn("ml-auto rounded-full px-1.5 text-2xs leading-5 font-strong tabular-nums", on ? "bg-on-primary-badge" : "bg-sidebar-badge", collapsed && "sr-only")}>
                      {item.count}
                    </span>
                  )}
                </a>
              </Tip>
            </div>
          );
        })}
      </div>
      {(account || foot) && (
        <div className="flex flex-none flex-col gap-2 border-t border-sidebar-border p-2.5">
          {account && (
            <Menu
              align="start"
              label="Account"
              trigger={(p) => (
                <Tip label={collapsed ? account.name : null} {...p}>
                  <button
                    type="button"
                    aria-label={collapsed ? account.name : undefined}
                    className="flex min-h-10 min-w-0 items-center gap-2.5 rounded-ctl px-0.5 text-left hover:bg-sidebar-hover phone:min-h-tap"
                  >
                    <Avatar name={account.name} src={account.photo} size="md" tone="brand" />
                    {!collapsed && (
                      <span className="min-w-0 leading-tight">
                        <b className="block truncate text-sm font-semibold" data-copy="content">
                          {account.name}
                        </b>
                        {account.subtitle && (
                          <span className="block truncate text-2xs text-sidebar-muted" data-copy="content">
                            {account.subtitle}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </Tip>
              )}
              items={account.menu}
            />
          )}
          {foot != null && <div className={cn("pl-0.5 text-2xs whitespace-nowrap text-sidebar-muted", collapsed && "invisible")}>{foot}</div>}
        </div>
      )}
    </nav>
  );
}
