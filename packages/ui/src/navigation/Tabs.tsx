/**
 * @component Tabs
 * @group Navigation
 * @summary The module's tab strip: one row of tabs under the page header, one of them active, with an optional count on each.
 * @use Sibling views of one module or record (Register, Field Assignments, Location Requests). Controlled by value, so the router drives it from ?tab=; give each tab an href so it opens in a new tab and survives a reload.
 * @avoid Two or three views of one list in a toolbar (use SegmentedControl); filtering a list (use Chips); steps of a form (use Wizard); more than one strip on a screen.
 * @phone One row that scrolls sideways inside itself, never the page; the active tab is brought into view; each tab is a 44 px target. On a desktop too narrow for every tab, the row keeps the tabs that fit, the active one always among them, and the rest wait behind More Tabs (a ⋯ menu at the end, dotted when a hidden tab has a count).
 * @a11y A tablist named by `label` (Radix underneath): one Tab stop for the strip, Left and Right between tabs, Home and End to the ends, Enter or Space activates (manual activation, so arrowing does not load every view). With TabPanel children each tab controls its panel; as a bare strip over a routed screen it controls nothing.
 * @status stable
 * @exports TabPanel
 * @example <Tabs label="Attendance" value={tab} onValueChange={(t) => navigate(`/attendance?tab=${t}`)} items={[{ value: "register", label: "Register", href: "/attendance?tab=register" }]} />
 * @example <Tabs label="Employee" value={tab} onValueChange={setTab} items={items}><TabPanel value="profile">...</TabPanel></Tabs>
 */
import { Children, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { IconButton } from "../actions/Button";
import { Menu } from "../overlay/Menu";
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

/** The strip's gap between tabs (gap-0.5), counted with each tab's width. */
const TAB_GAP = 2;

/** Room kept at the end of a narrowed strip for the More Tabs button (size-control, and a gap). */
const MORE_WIDTH = 48;

/**
 * Which tabs a desktop strip of `room` pixels shows, from each tab's measured width: as many as
 * fit in order, with room left for More Tabs when some do not; the active tab is always shown, in
 * the place of the last one that fitted. Everything fits (or nothing is measured yet): all of them.
 */
export function visibleTabs(widths: number[], room: number, active: number): number[] {
  const all = widths.map((_, i) => i);
  const w = (i: number) => widths[i] ?? 0;
  const total = widths.reduce((a, b) => a + b, 0);
  if (!room || total <= room) return all;
  const shown: number[] = [];
  let used = 0;
  for (const i of all) {
    if (used + w(i) > room - MORE_WIDTH) break;
    shown.push(i);
    used += w(i);
  }
  if (active >= 0 && !shown.includes(active)) {
    while (shown.length && used + w(active) > room - MORE_WIDTH) used -= w(shown.pop()!);
    shown.push(active);
  }
  return shown.length ? shown : [active >= 0 ? active : 0];
}

/** Each tab's width and the strip's room, measured on desktop and again whenever the strip resizes. */
function useOverflow(enabled: boolean, items: TabItem[]) {
  const box = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ widths: number[]; room: number }>({ widths: [], room: 0 });
  const key = items.map((i) => `${i.value}:${i.count ?? ""}`).join("|");
  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const widths = Array.from(ruler.current?.children ?? []).map((el) => (el as HTMLElement).offsetWidth + TAB_GAP);
      const room = box.current?.clientWidth ?? 0;
      setSize((was) => (was.room === room && was.widths.join() === widths.join() ? was : { widths, room }));
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !box.current) return;
    const watch = new ResizeObserver(measure);
    watch.observe(box.current);
    // The ruler resizes when a font arrives late or a count changes length.
    if (ruler.current) watch.observe(ruler.current);
    return () => watch.disconnect();
  }, [enabled, key]);
  return { box, ruler, ...size };
}

export function Tabs({ items, value, onValueChange, label, children, activation = "manual", className }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children).length > 0;
  const phone = useIsPhone();
  for (const item of items) warnOverLimit("Tab", item.label, WORD_LIMITS.button);

  // A phone scrolls the row sideways; a desktop shows what fits and keeps the rest behind More Tabs.
  const fit = useOverflow(!phone, items);
  const active = items.findIndex((i) => i.value === value);
  const shownIdx = phone || fit.widths.length !== items.length ? items.map((_, i) => i) : visibleTabs(fit.widths, fit.room, active);
  const shown = new Set(shownIdx);
  const hidden = items.filter((_, i) => !shown.has(i));
  const choose = (item: TabItem) => {
    if (onValueChange) onValueChange(item.value);
    else if (item.href) window.location.assign(item.href);
  };

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

  const bodyOf = (item: TabItem) => (
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
    <Radix.Root value={value} onValueChange={onValueChange} activationMode={activation} className={className}>
      <div ref={fit.box} className="relative flex max-w-full min-w-0 items-end border-b border-border">
        {/* The ruler: every tab drawn once, unseen, so a hidden tab's width is known before it is shown again. */}
        {!phone && (
          <div ref={fit.ruler} aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-0.5 overflow-hidden">
            {items.map((item) => (
              <span key={item.value} className={TAB}>
                {bodyOf(item)}
              </span>
            ))}
          </div>
        )}
        <Radix.List ref={list} aria-label={label} className="no-scrollbar -mb-px flex max-w-full min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {items.filter((_, i) => shown.has(i)).map((item) => {
            const body = bodyOf(item);
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
        {hidden.length > 0 && (
          <Menu
            label="More Tabs"
            trigger={(p) => <IconButton {...p} icon="dots" label="More Tabs" dot={hidden.some((h) => (h.count ?? 0) > 0)} className="mb-0.5 flex-none" />}
            items={hidden.map((item) => ({ label: bodyOf(item), disabled: item.disabled, onSelect: () => choose(item) }))}
          />
        )}
      </div>
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
