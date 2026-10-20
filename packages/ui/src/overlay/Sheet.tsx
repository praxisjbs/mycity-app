/**
 * @component Sheet
 * @group Overlays
 * @summary The phone's bottom sheet: slides up with a spring, closes by dragging down, a tap on the scrim or Esc; one with a text field closes only on purpose.
 * @use Underneath Modal, SidePanel, Popover and Menu on a phone; directly for a phone-only sheet (the More launcher, a KPI detail).
 * @avoid A dialog on desktop (use Modal, which is this sheet on a phone and a centred dialog on desktop); a toast or banner for news.
 * @phone This is the phone form. `full` fills the screen for a long form or a reader; otherwise it is as tall as its content, up to most of the screen, with a grab handle. With the keyboard up it stays above it, header in view. Once it holds a text field it has no handle and a drag or a scrim tap never closes it (a scrim tap puts the keyboard away); the close button, Cancel and Esc do.
 * @a11y A modal dialog (Radix underneath): focus moves in and is trapped, Esc closes, focus returns to the opener. The title names it; `hideHeader` keeps the title for screen readers only.
 * @status stable
 * @example <Sheet open={open} onClose={() => setOpen(false)} title="Leave Balance">{balance}</Sheet>
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { cn } from "../lib/cn";
import { IconButton } from "../actions/Button";
import { FooterContext, IN_FOOTER, TEXT_ENTRY, escapeClosesList, focusInto, useReturnFocus } from "./context";

export interface ChromeProps {
  /** The heading. */
  title: ReactNode;
  /** A short line under the heading, desktop only; also the dialog's description. */
  sub?: ReactNode;
  /** Keep the title for screen readers only and draw no header row (an action sheet). */
  hideHeader?: boolean;
  /** Buttons for the sticky footer. */
  footer?: ReactNode;
  /** The body. */
  children?: ReactNode;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
}

/**
 * The inside of every overlay: a header with the title and a close button, a
 * body that scrolls, and a sticky footer that holds buttons only. Bodies can
 * portal buttons into the footer with ModalFooter, so a form keeps its state
 * while its buttons stay in reach.
 */
export function Chrome({ title, sub, hideHeader, footer, children, bodyClassName }: ChromeProps) {
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const slot = useMemo(() => ({ inOverlay: true, target: footerEl, inFooter: false }), [footerEl]);
  return (
    <FooterContext.Provider value={slot}>
      {hideHeader ? (
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
      ) : (
        <div className="flex flex-none items-center gap-2.5 border-b border-border py-2.5 pr-3 pl-4.5">
          <Dialog.Title data-ui="title" className="min-w-0 flex-1 truncate text-md font-strong">
            {title}
          </Dialog.Title>
          <Dialog.Close asChild>
            <IconButton icon="x" label="Close" size="sm" />
          </Dialog.Close>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4.5 py-4 empty:hidden", bodyClassName)}>
        {sub ? (
          <Dialog.Description data-ui="page-subtitle" className="-mt-1 mb-3 text-xs text-subtle-foreground phone:sr-only">
            {sub}
          </Dialog.Description>
        ) : null}
        {children}
      </div>
      <div
        ref={setFooterEl}
        data-ui="modal-footer"
        className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-border px-4.5 py-3 empty:hidden phone:flex-col phone:flex-nowrap phone:items-stretch"
      >
        {footer ? <FooterContext.Provider value={IN_FOOTER}>{footer}</FooterContext.Provider> : null}
      </div>
    </FooterContext.Provider>
  );
}

export interface SheetProps {
  /** Whether the sheet is showing. */
  open: boolean;
  /** Called when the person dismisses it (drag down, scrim, Esc, the close button). Keep `open` true to refuse, and the sheet springs back. */
  onClose: () => void;
  /** The heading, at most 4 words, Title Case. */
  title: ReactNode;
  /** A short line under the heading; hidden on a phone, kept as the dialog's description. */
  sub?: ReactNode;
  /** No header row: the title is read by screen readers only (an action sheet). */
  hideHeader?: boolean;
  /** Fill the screen (a long form, a composer, a reader) instead of fitting the content. */
  full?: boolean;
  /** Buttons for the footer; the main action is last and full width at the bottom. */
  footer?: ReactNode;
  /** The body. */
  children?: ReactNode;
  /** false: drag, scrim and Esc do nothing (the close button and Cancel still work). Default true. A sheet holding a text field ignores the drag and the scrim anyway. */
  dismissible?: boolean;
  /** Blur the screen behind the scrim, for a prompt that must be answered before anything else (the clock prompts). */
  blur?: boolean;
  /** `alertdialog` for a confirmation. Default `dialog`. */
  role?: "dialog" | "alertdialog";
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
}

/**
 * Whether a text field sits in the sheet, watched as its body renders (a form
 * can arrive after the sheet opens).
 */
function useHoldsFields(el: HTMLElement | null): boolean {
  const [holds, setHolds] = useState(false);
  useLayoutEffect(() => {
    if (!el) return;
    const check = () => setHolds(!!el.querySelector(TEXT_ENTRY));
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [el]);
  return !!el && holds;
}

/**
 * Keeps the sheet inside what the phone's keyboard leaves visible. The keyboard
 * shrinks only the visual viewport (iOS, and Android by default), so a sheet
 * pinned to the bottom of the page would sit behind it and the browser would
 * pan the page to reach the field, taking the header off the top. Here the
 * sheet's bottom follows the visible area and its height never passes it.
 */
function useKeyboardInset(el: HTMLElement | null, full: boolean): void {
  useEffect(() => {
    const view = window.visualViewport;
    if (!el || !view) return;
    let lastInset = 0;
    const place = () => {
      // A pinch zoom also shrinks the visual viewport; only the keyboard moves the sheet.
      const zoomed = view.scale > 1.01;
      const top = zoomed ? 0 : Math.max(0, Math.round(view.offsetTop));
      const inset = zoomed ? 0 : Math.max(0, Math.round(document.documentElement.clientHeight - view.height - view.offsetTop));
      el.style.bottom = inset ? `${inset}px` : "";
      if (full) el.style.top = top ? `${top}px` : "";
      else el.style.maxHeight = inset || top ? `${Math.floor((view.height * 11) / 12)}px` : "";
      if (inset === lastInset) return;
      lastInset = inset;
      // The keyboard came up or changed size: bring the field being typed in back into view.
      const field = document.activeElement;
      if (inset && field instanceof HTMLElement && el.contains(field)) {
        requestAnimationFrame(() => field.scrollIntoView({ block: "nearest" }));
      }
    };
    place();
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place);
    return () => {
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place);
      el.style.bottom = "";
      el.style.top = "";
      el.style.maxHeight = "";
    };
  }, [el, full]);
}

export function Sheet({ open, onClose, title, sub, hideHeader, full, footer, children, dismissible = true, blur = false, role, container, bodyClassName }: SheetProps) {
  const content = useRef<HTMLDivElement | null>(null);
  // The sheet's element as state too: it mounts after the first render, and the hooks below start then.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const contentRef = useCallback((el: HTMLDivElement | null) => {
    content.current = el;
    setNode(el);
  }, []);
  const overlay = useRef<HTMLDivElement>(null);
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  const returnFocus = useReturnFocus(open);
  useKeyboardInset(node, !!full);
  const holdsFields = useHoldsFields(node);
  // Typing is never lost to a stray swipe or tap: a sheet with a text field and a close button
  // closes only through that button, Cancel or Esc.
  const locked = !dismissible || (holdsFields && !hideHeader);

  const change = (next: boolean) => {
    if (next) return;
    onClose();
    // The owner may refuse (unsaved changes): spring back from wherever the drag left it.
    // Vaul moves the sheet with inline transforms while dragging, so the reset is inline too.
    requestAnimationFrame(() => {
      if (!isOpen.current) return;
      if (content.current) {
        content.current.style.transition = "transform var(--dur) var(--ease-spring)";
        content.current.style.transform = "translate3d(0, 0, 0)";
      }
      if (overlay.current) overlay.current.style.opacity = "1";
    });
  };

  return (
    // `container` goes to the portal only: on the root it would drop the sheet's own overscroll
    // fill, which is also what lets a drag start on a scrolled page.
    // The sheet places itself around the keyboard (useKeyboardInset), so Vaul's own repositioning is off.
    <Drawer.Root open={open} onOpenChange={change} handleOnly={locked} repositionInputs={false}>
      <Drawer.Portal container={container ?? undefined}>
        <Drawer.Overlay ref={overlay} data-blur={blur || undefined} className={cn("fixed inset-0 z-50 bg-scrim", blur && "backdrop-blur-md")} />
        <Drawer.Content
          ref={contentRef}
          role={role ?? "dialog"}
          data-ui="modal"
          aria-modal="true"
          {...(sub ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusInto(content.current, true);
          }}
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={(e) => (!dismissible || escapeClosesList(e)) && e.preventDefault()}
          onPointerDownOutside={(e) => {
            if (!locked) return;
            e.preventDefault();
            // A tap beside a locked sheet puts the keyboard away instead.
            content.current?.focus();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-card pb-safe text-card-foreground outline-none",
            full ? "top-0 pt-safe" : "max-h-11/12 rounded-t-sheet border-t border-border shadow-3",
          )}
        >
          {!full && !locked && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-border" />}
          <Chrome title={title} sub={sub} hideHeader={hideHeader} footer={footer} bodyClassName={bodyClassName}>
            {children}
          </Chrome>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
