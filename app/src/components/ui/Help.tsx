import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/lib/media";
import { IconButton } from "./Button";
import { Icon } from "./Icon";

/**
 * Tier 2 help (FRONTEND_GUIDE §5.2): the only two ways a screen hides and
 * reveals support text.
 *
 *   <HelpTerm text="Minutes past the shift start, after the grace period.">Over By</HelpTerm>
 *   <HelpIcon label="Clocked in by hour" text="..." />   where there is no word to attach to
 *   <Details>{...label and value pairs...}</Details>       one per card, at its foot
 *
 * A help term is the word itself, dotted underlined. Desktop: hover or Tab
 * opens a popover after about 300 ms; it stays while the pointer is over the
 * term or the popover, and Esc closes it. Phone: a tap opens a bottom sheet.
 * The text is always in the DOM, hidden (aria-describedby still reads it),
 * so it never joins the accessible name of a label or heading it sits in.
 *
 * At most 35 words in a help term, 60 in a Details row; more is tier 3 and
 * belongs in the manual (gate 8 counts them).
 */

const OPEN_DELAY = 300;
const CLOSE_DELAY = 120;

function useHoverOpen() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => window.clearTimeout(timer.current);
  const show = useCallback((delay = OPEN_DELAY) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, []);
  useEffect(() => clear, []);
  return { open, setOpen, show, hide, keep: clear };
}

/** The phone's bottom sheet for help and Details. Not the shared modal: a help term inside a form must not close the form. */
function HelpSheet({ title, onClose, children, slot = "help" }: { title: ReactNode; onClose: () => void; children: ReactNode; slot?: "help" | "details" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-x-0 top-(--env-bar) bottom-0 z-[90] flex items-end bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Help"} className="w-full animate-rise rounded-t-[18px] border border-border bg-card pb-[calc(16px+env(safe-area-inset-bottom,0px))] shadow-3">
        <div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-[18px]">
          <b className="min-w-0 flex-1 text-[14px]">{title}</b>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div data-ui={slot} className="px-[18px] pt-3 text-[13px] leading-normal text-muted-foreground">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The desktop popover, placed under its anchor and kept on screen. */
function Popover({ anchor, onEnter, onLeave, children }: { anchor: HTMLElement; onEnter: () => void; onLeave: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 280;
    const h = box.current?.offsetHeight ?? 60;
    const below = r.bottom + 6 + h < window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : r.top - 6 - h, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
  }, [anchor]);
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      data-ui="help"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[95] max-w-[300px] rounded-box border border-border bg-card px-3 py-2.5 text-[12.5px] leading-normal font-normal text-muted-foreground shadow-3"
    >
      {children}
    </div>,
    document.body,
  );
}

/** A word with help behind it: the dotted underline is its only marker. */
export function HelpTerm({ text, children, className }: { text: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  const mobile = useIsMobile();
  const ref = useRef<HTMLSpanElement>(null);
  const h = useHoverOpen();
  const toggle = () => h.setOpen((o) => !o);
  return (
    <>
      <span
        ref={ref}
        data-ui="help-term"
        role="button"
        tabIndex={0}
        aria-describedby={id}
        aria-expanded={h.open}
        onMouseEnter={mobile ? undefined : () => h.show()}
        onMouseLeave={mobile ? undefined : h.hide}
        onFocus={mobile ? undefined : () => h.show()}
        onBlur={mobile ? undefined : h.hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") h.setOpen(false);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn("cursor-help underline decoration-subtle-foreground decoration-dotted decoration-1 underline-offset-[3px] outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        {children}
      </span>
      <span id={id} hidden>
        {text}
      </span>
      {h.open && !mobile && ref.current && (
        <Popover anchor={ref.current} onEnter={h.keep} onLeave={h.hide}>
          {text}
        </Popover>
      )}
      {h.open && mobile && (
        <HelpSheet title={children} onClose={() => h.setOpen(false)}>
          {text}
        </HelpSheet>
      )}
    </>
  );
}

/** ⓘ, only where there is no word to attach help to (a chart, an icon-only control). */
export function HelpIcon({ label, text }: { label: string; text: ReactNode }) {
  const id = useId();
  const mobile = useIsMobile();
  const ref = useRef<HTMLButtonElement>(null);
  const h = useHoverOpen();
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-ui="help-term"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={h.open}
        onMouseEnter={mobile ? undefined : () => h.show()}
        onMouseLeave={mobile ? undefined : h.hide}
        onFocus={mobile ? undefined : () => h.show()}
        onBlur={mobile ? undefined : h.hide}
        onClick={() => h.setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && h.setOpen(false)}
        className="inline-flex size-[22px] flex-none items-center justify-center rounded-full align-middle text-subtle-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Icon name="info" />
      </button>
      <span id={id} hidden>
        {text}
      </span>
      {h.open && !mobile && ref.current && (
        <Popover anchor={ref.current} onEnter={h.keep} onLeave={h.hide}>
          {text}
        </Popover>
      )}
      {h.open && mobile && (
        <HelpSheet title={label} onClose={() => h.setOpen(false)}>
          {text}
        </HelpSheet>
      )}
    </>
  );
}

/**
 * The Details row at the foot of a card: closed on every visit, never
 * remembered. Desktop expands inline; a phone opens a bottom sheet. Short
 * label and value pairs rather than prose.
 */
export function Details({ items, children, title = "Details" }: { items?: Array<[ReactNode, ReactNode]>; children?: ReactNode; title?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const id = useId();
  const body = (
    <>
      {items && (
        <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
          {items.map(([k, v], i) => (
            <div key={i} className="contents">
              <dt className="text-subtle-foreground">{k}</dt>
              <dd className="m-0 text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </>
  );
  return (
    <div className="-mx-[14px] mt-3 -mb-[14px] border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-[14px] py-2.5 text-left text-[12.5px] font-semibold text-muted-foreground hover:text-foreground max-md:min-h-11"
      >
        <Icon name="right" className={cn("size-[14px] transition-transform", open && !mobile && "rotate-90")} />
        Details
      </button>
      {open && !mobile && (
        <div id={id} data-ui="details" className="px-[14px] pb-[14px] text-[12.5px] text-muted-foreground">
          {body}
        </div>
      )}
      {open && mobile && (
        <HelpSheet title={title} onClose={() => setOpen(false)} slot="details">
          {body}
        </HelpSheet>
      )}
    </div>
  );
}
