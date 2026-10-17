/**
 * @component Sheet
 * @group Overlays
 * @summary The phone's bottom sheet: slides up with a spring, closes by dragging down, a tap on the scrim or Esc.
 * @use Underneath Modal, SidePanel, Popover and Menu on a phone; directly for a phone-only sheet (the More launcher, a KPI detail).
 * @avoid A dialog on desktop (use Modal, which is this sheet on a phone and a centred dialog on desktop); a toast or banner for news.
 * @phone This is the phone form. `full` fills the screen for a long form or a reader; otherwise it is as tall as its content, up to most of the screen, with a grab handle.
 * @a11y A modal dialog (Radix underneath): focus moves in and is trapped, Esc closes, focus returns to the opener. The title names it; `hideHeader` keeps the title for screen readers only.
 * @status stable
 * @example <Sheet open={open} onClose={() => setOpen(false)} title="Leave Balance">{balance}</Sheet>
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { cn } from "../lib/cn";
import { IconButton } from "../actions/Button";
import { FooterContext, IN_FOOTER, focusInto, useReturnFocus } from "./context";

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
  /** false: drag, scrim and Esc do nothing (the close button and Cancel still work). Default true. */
  dismissible?: boolean;
  /** `alertdialog` for a confirmation. Default `dialog`. */
  role?: "dialog" | "alertdialog";
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
}

export function Sheet({ open, onClose, title, sub, hideHeader, full, footer, children, dismissible = true, role, container, bodyClassName }: SheetProps) {
  const content = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  const returnFocus = useReturnFocus(open);

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
    <Drawer.Root open={open} onOpenChange={change} dismissible={dismissible}>
      <Drawer.Portal container={container ?? undefined}>
        <Drawer.Overlay ref={overlay} className="fixed inset-0 z-50 bg-scrim" />
        <Drawer.Content
          ref={content}
          role={role ?? "dialog"}
          data-ui="modal"
          aria-modal="true"
          {...(sub ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusInto(content.current, true);
          }}
          onCloseAutoFocus={returnFocus}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-card pb-safe text-card-foreground outline-none",
            full ? "top-0 pt-safe" : "max-h-11/12 rounded-t-sheet border-t border-border shadow-3",
          )}
        >
          {!full && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-border" />}
          <Chrome title={title} sub={sub} hideHeader={hideHeader} footer={footer} bodyClassName={bodyClassName}>
            {children}
          </Chrome>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
