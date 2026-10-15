/**
 * @component Tabs
 * @group Navigation
 * @summary The module's tab strip: one row of tabs under the page header, one of them active, with an optional count on each.
 * @use Sibling views of one module or record (Register, Field Assignments, Location Requests). Controlled by value, so the router drives it from ?tab=; give each tab an href so it opens in a new tab and survives a reload.
 * @avoid Two or three views of one list in a toolbar (use SegmentedControl); filtering a list (use Chips); steps of a form (use Wizard); more than one strip on a screen.
 * @phone One row that scrolls sideways inside itself, never the page; the active tab is brought into view; each tab is a 44 px target.
 * @a11y A tablist named by `label` (Radix underneath): one Tab stop for the strip, Left and Right between tabs, Home and End to the ends, Enter or Space activates (manual activation, so arrowing does not load every view). With TabPanel children each tab controls its panel; as a bare strip over a routed screen it controls nothing.
 * @status stable
 * @exports TabPanel
 * @example <Tabs label="Attendance" value={tab} onValueChange={(t) => navigate(`/attendance?tab=${t}`)} items={[{ value: "register", label: "Register", href: "/attendance?tab=register" }]} />
 * @example <Tabs label="Employee" value={tab} onValueChange={setTab} items={items}><TabPanel value="profile">...</TabPanel></Tabs>
 */
import { Children, useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { CountBadge } from "../display/CountBadge";
import { WORD_LIMITS, warnOverLimit } from "../help/words";

/** One tab. */
export interface TabItem {
  /** The tab's key: the ?tab= slug. */
  value: string;
  /** What the person reads: Title Case, at most 3 words. */
  label: ReactNode;
  /** A count beside the label (approvals waiting); nothing is drawn for 0. */
  count?: number;
  /** Where the tab lives, so it can be opened in a new browser tab; a plain click still goes through onValueChange. */
  href?: string;
  /** A glyph before the label. */
  icon?: IconName;
  /** Shown but not choosable. */
  disabled?: boolean;
}

export interface TabsProps {
  /** The tabs, in order. */
  items: TabItem[];
  /** The active tab's value (controlled: the router or the screen owns it). */
  value: string;
  /** Called with the chosen tab's value; navigate or set state here. */
  onValueChange?: (value: string) => void;
  /** Names the strip for assistive technology: the module or record ("Attendance"). */
  label: string;
  /** TabPanel elements, when the views live on this screen; leave out when the router renders the view. */
  children?: ReactNode;
  /** `manual` (the default): arrows move focus and Enter activates. `automatic`: arrows activate. */
  activation?: "manual" | "automatic";
  /** Layout classes for the whole block (spacing). */
  className?: string;
}

const TAB =
  "-mb-px inline-flex h-control flex-none items-center gap-1.5 border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground no-underline transition-colors duration-(--dur-fast) hover:text-foreground disabled:opacity-40 phone:min-h-tap data-[state=active]:border-secondary data-[state=active]:font-strong data-[state=active]:text-foreground dark:data-[state=active]:border-primary";

/** A plain left click; a modified one (new tab, new window) is left to the browser. */
const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function Tabs({ items, value, onValueChange, label, children, activation = "manual", className }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children).length > 0;
  for (const item of items) warnOverLimit("Tab", item.label, WORD_LIMITS.button);

  // Bring the active tab into view inside the strip, without scrolling the page.
  useEffect(() => {
    const strip = list.current;
    const tab = strip?.querySelector<HTMLElement>('[data-state="active"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 16);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 16;
  }, [value]);

  return (
    <Radix.Root value={value} onValueChange={onValueChange} activationMode={activation} className={className}>
      <Radix.List ref={list} aria-label={label} className="no-scrollbar flex max-w-full min-w-0 gap-0.5 overflow-x-auto border-b border-border">
        {items.map((item) => {
          const body = (
            <>
              {item.icon && <Icon name={item.icon} />}
              {item.label}
              {item.count != null && (
                <>
                  {" "}
                  <CountBadge count={item.count} tone="neutral" />
                </>
              )}
            </>
          );
          return (
            <Radix.Trigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              asChild={!!item.href}
              data-ui="button"
              className={TAB}
              // A bare strip over a routed screen has no panel here to point at.
              {...(panels ? {} : { "aria-controls": undefined })}
            >
              {item.href ? (
                <a
                  href={item.href}
                  onClick={(e) => {
                    if (onValueChange && plain(e)) e.preventDefault();
                  }}
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </Radix.Trigger>
          );
        })}
      </Radix.List>
      {children}
    </Radix.Root>
  );
}

export interface TabPanelProps {
  /** The tab it belongs to. */
  value: string;
  /** The view. */
  children?: ReactNode;
  /** Layout classes (spacing). */
  className?: string;
}

/** One tab's view, shown while its tab is active. */
export function TabPanel({ value, children, className }: TabPanelProps) {
  return (
    <Radix.Content value={value} className={cn("pt-4", className)}>
      {children}
    </Radix.Content>
  );
}
