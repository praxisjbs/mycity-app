/**
 * @component HelpTerm
 * @group Help
 * @summary The word a piece of help explains, with a light dotted underline; hovering, tabbing to or tapping it shows one or two sentences.
 * @use Tier 2 support text of one or two sentences attached to the word it explains: a field label, a KPI title, a column header, a card title ("Over By", "Grace Period").
 * @avoid Anything a person must read before acting (put it on the control or in the confirmation); more than 35 words (tier 3: the manual); a section of facts (use Details); a chart or icon with no word (use InfoButton).
 * @phone No hover: a tap opens the text in a bottom sheet titled by the term, closed by dragging down, the scrim or Esc.
 * @a11y The term is a button with a dotted underline. The text is always in the DOM in a visually hidden node outside any label or heading, linked with aria-describedby, so it never joins the accessible name of what it explains. Desktop: opens after about 300 ms on hover or on reaching it with Tab, stays while the pointer is over the term or the popover, Esc closes it (WCAG 1.4.13). Pass helpId to describe a field's control by the same text.
 * @status stable
 * @example <HelpTerm help="Minutes past the shift start before a punch counts as late.">Grace Period</HelpTerm>
 * @example <CardHeader title={<HelpTerm help="Hours worked beyond the rostered shift this week.">Over By</HelpTerm>} />
 */
import { cloneElement, useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Radix from "@radix-ui/react-popover";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Sheet } from "../overlay/Sheet";
import { WORD_LIMITS, warnOverLimit } from "./words";

/** Hover and Tab open after this long, so a pointer crossing a row of terms does not flash every one. */
export const HELP_OPEN_MS = 300;
/** The grace the pointer has to cross the gap from the term into the popover. */
export const HELP_CLOSE_MS = 150;

/* Focus opens the popover only when it arrived by the Tab key: a dialog that
   moves focus to its first control on open, or a click, must not pop help over it. */
let tabbed = false;
let listening = false;
function listenForTab() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("keydown", (e) => (tabbed = e.key === "Tab"), true);
  document.addEventListener("pointerdown", () => (tabbed = false), true);
}

/** The hidden node's id: the caller's, or one minted here (valid as a CSS selector). */
function useHelpId(helpId?: string): string {
  const own = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return helpId ?? `help-${own}`;
}

export interface HelpSurfaceProps {
  /** The element that opens it: a <button>. It receives the handlers, the ref and aria-describedby. */
  trigger: ReactElement;
  /** The help text. */
  help: ReactNode;
  /** The phone sheet's title. */
  title: string;
  /** The hidden node's id. */
  helpId?: string;
  /** The popover's side on desktop. */
  side?: "top" | "right" | "bottom" | "left";
  /** The popover's alignment on desktop. */
  align?: "start" | "center" | "end";
  /** Where the popover and sheet mount; document.body by default. */
  container?: HTMLElement | null;
}

/**
 * What HelpTerm and InfoButton share: the hidden description, the desktop
 * popover (hover, Tab, click, Esc) and the phone sheet. Not exported from the
 * package; a screen uses HelpTerm or InfoButton.
 */
export function HelpSurface({ trigger, help, title, helpId, side = "top", align = "center", container }: HelpSurfaceProps) {
  const phone = useIsPhone();
  const id = useHelpId(helpId);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(listenForTab, []);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const close = () => {
    clear();
    pinned.current = false;
    setOpen(false);
  };
  const openSoon = () => {
    clear();
    timer.current = setTimeout(() => setOpen(true), HELP_OPEN_MS);
  };
  const closeSoon = () => {
    if (pinned.current) return;
    clear();
    timer.current = setTimeout(() => setOpen(false), HELP_CLOSE_MS);
  };

  const handlers = {
    ref: (node: HTMLElement | null) => {
      anchor.current = node;
    },
    "aria-describedby": id,
    onPointerEnter: (e: PointerEvent) => {
      if (!phone && e.pointerType === "mouse") openSoon();
    },
    onPointerLeave: (e: PointerEvent) => {
      if (!phone && e.pointerType === "mouse") closeSoon();
    },
    onFocus: () => {
      if (!phone && tabbed) openSoon();
    },
    onBlur: close,
    onClick: () => {
      if (phone) return setSheet(true);
      clear();
      const next = !(open && pinned.current);
      pinned.current = next;
      setOpen(next);
    },
  };

  return (
    <>
      <Radix.Root open={!phone && open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <Radix.Anchor asChild>{cloneElement(trigger, handlers)}</Radix.Anchor>
        <Radix.Portal container={container ?? undefined}>
          <Radix.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            // Read-only text: focus stays where the person is, on open and on close.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            // A press on the term itself toggles it; Radix would otherwise count it as outside.
            onInteractOutside={(e) => {
              if (anchor.current?.contains(e.target as Node)) e.preventDefault();
            }}
            onPointerEnter={clear}
            onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
            // The trigger already carries this text through aria-describedby; the panel is its visible copy.
            aria-hidden="true"
            data-help-popover=""
            className="z-50 max-w-xs animate-rise rounded-box border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-3 outline-none"
          >
            <p data-ui="help">{help}</p>
          </Radix.Content>
        </Radix.Portal>
      </Radix.Root>
      {typeof document !== "undefined" &&
        createPortal(
          <span id={id} data-ui="help" className="sr-only">
            {help}
          </span>,
          document.body,
        )}
      {phone && (
        <Sheet open={sheet} onClose={() => setSheet(false)} title={title} container={container}>
          <p data-ui="help" className="text-body">
            {help}
          </p>
        </Sheet>
      )}
    </>
  );
}

export interface HelpTermProps {
  /** The word or short phrase it explains, as the screen shows it (a label, a KPI title, a column header). */
  children: ReactNode;
  /** The help: one or two sentences, at most 35 words, sentence case. */
  help: ReactNode;
  /** The phone sheet's title; the term itself when it is plain text, else "Help". */
  title?: string;
  /** The hidden text's id, so a field can add it to its control's aria-describedby (useControlIds().helpId). */
  helpId?: string;
  /** Which side of the term the desktop popover opens on. Default `top`. */
  side?: "top" | "right" | "bottom" | "left";
  /** The popover's alignment along that side. Default `center`. */
  align?: "start" | "center" | "end";
  /** Where the popover and the sheet mount; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Layout classes only. */
  className?: string;
}

export function HelpTerm({ children, help, title, helpId, side, align, container, className }: HelpTermProps) {
  warnOverLimit("Help text", help, WORD_LIMITS.help);
  const sheetTitle = title ?? (typeof children === "string" ? children : "Help");
  return (
    <HelpSurface
      help={help}
      title={sheetTitle}
      helpId={helpId}
      side={side}
      align={align}
      container={container}
      trigger={
        <button
          type="button"
          data-help-term=""
          className={cn(
            "inline cursor-help rounded-sm border-0 bg-transparent p-0 text-left underline decoration-subtle-foreground decoration-dotted decoration-1 underline-offset-4 hover:decoration-foreground",
            className,
          )}
        >
          {children}
        </button>
      }
    />
  );
}
