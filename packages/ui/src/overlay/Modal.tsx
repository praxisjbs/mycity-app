/**
 * @component Modal
 * @group Overlays
 * @summary THE modal: a centred dialog on desktop and a bottom sheet on a phone, opened with useModal or controlled with open.
 * @use Create or edit with up to 6 fields, a record's detail, a short reader. useModal().open({ title, body }) from anywhere under ModalProvider; <Modal open> when the screen owns the state.
 * @avoid A destructive yes or no (use useConfirm); editing the record behind it on desktop (use SidePanel); more than 6 fields (a wizard); a stack of dialogs (opening one replaces the last).
 * @phone A bottom sheet that drags down to close, with the main action full width at the bottom; `full` makes it a full-screen sheet (a composer, a long form). It stays above the keyboard, header in view; once it holds a text field only the close button, Cancel or Esc close it.
 * @a11y Radix Dialog underneath: aria-modal, focus moves in and is trapped, Esc closes, focus returns to the opener. The title (at most 4 words) names it. With unsaved changes, Esc, the scrim, the close button or a drag ask once to discard. Its buttons are one ActionGroup: while one is working the others wait, and Esc, the scrim, a drag and the close button do nothing until it finishes (F26).
 * @status stable
 * @exports ModalProvider, ModalFooter, Grow
 * @example modal.open({ title: "New Rule", body: (close) => <RuleForm close={close} /> })
 * @example <Modal open={open} onClose={() => setOpen(false)} title="Edit Worksite" footer={<Button variant="primary">Save Worksite</Button>}>{fields}</Modal>
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Button } from "../actions/Button";
import { ActionGroup } from "../actions/ActionGroup";
import { PressGroupContext, usePressGroup } from "../actions/press";
import { Chrome, Sheet } from "./Sheet";
import { FooterContext, HostContext, IN_FOOTER, OverlayContext, escapeClosesList, focusInto, useReturnFocus, type HostLayer, type OverlayState } from "./context";

/** Content, or a function of `close` so a form can close its own modal after saving. */
export type ModalContent = ReactNode | ((close: () => void) => ReactNode);

const WIDTH = { sm: "max-w-sm", md: "max-w-lg", wide: "max-w-3xl" } as const;
const SIDE_WIDTH = { sm: "max-w-sm", md: "max-w-md", wide: "max-w-2xl" } as const;

export interface ModalProps {
  /** Whether it is showing. */
  open: boolean;
  /** Called to close it: after a dismissal (Esc, scrim, close button, drag), once any unsaved changes are discarded. */
  onClose: () => void;
  /** The title: a noun phrase of at most 4 words, Title Case ("New Rule", "Edit Worksite"). */
  title: ReactNode;
  /** A line under the title, at most 8 words, desktop only; kept as the dialog's description. */
  sub?: ReactNode;
  /** The body, or a function of `close`. */
  children?: ModalContent;
  /** Footer buttons only (Cancel, then the primary), or a function of `close`. A body can also use ModalFooter. */
  footer?: ModalContent;
  /** The wider desktop dialog (tables, documents). Same as size="wide". */
  wide?: boolean;
  /** Desktop width: `sm` a confirmation, `md` a form (the default), `wide` a table or document. */
  size?: "sm" | "md" | "wide";
  /** A full-screen sheet on a phone (a composer, a long form, a reader). No change on desktop. */
  full?: boolean;
  /** A side panel over the record on desktop instead of a centred dialog; a full sheet on a phone. SidePanel sets it. */
  side?: boolean;
  /** Unsaved changes: a dismissal asks once to discard them. Forms inside can also say so with useUnsavedChanges. */
  dirty?: boolean;
  /** false: Esc, the scrim and a drag do nothing; the close button and the footer still close it. Default true. */
  dismissible?: boolean;
  /** Blur the screen behind the scrim, for a prompt that must be answered before anything else (the clock prompts). */
  blur?: boolean;
  /** `alertdialog` for a confirmation that must be answered. Default `dialog`. */
  role?: "dialog" | "alertdialog";
  /** Where it mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
}

const render = (c: ModalContent | undefined, close: () => void) => (typeof c === "function" ? c(close) : c);

export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
  size,
  full,
  side,
  dirty = false,
  dismissible = true,
  blur = false,
  role,
  container,
  bodyClassName,
}: ModalProps) {
  const phone = useIsPhone();
  const box = useRef<HTMLDivElement>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const returnFocus = useReturnFocus(open);
  // Its own group: the page behind may be busy (the button that opened it), and that must not hold it.
  const group = usePressGroup(true);
  const { isBusy } = group;

  // The overlay context stays stable (a form's effect depends on it), so it reads the latest values through a ref.
  const latest = useRef({ unsaved: dirty || formDirty, onClose });
  useLayoutEffect(() => {
    latest.current = { unsaved: dirty || formDirty, onClose };
  });
  const dismiss = useCallback(() => {
    // Mid-save, a dismissal would lose the answer: it waits like the buttons do. A save that
    // succeeds closes the modal through `close`, which is not a dismissal.
    if (isBusy()) return;
    if (latest.current.unsaved) setAsking(true);
    else latest.current.onClose();
  }, [isBusy]);
  const overlay = useMemo<OverlayState>(() => ({ setDirty: setFormDirty, dismiss }), [dismiss]);

  useEffect(() => {
    if (!open) setAsking(false);
  }, [open]);

  const discard = () => {
    setAsking(false);
    setFormDirty(false);
    onClose();
  };

  const width = size ?? (wide ? "wide" : "md");
  const body = render(children, onClose);
  const foot = render(footer, onClose);

  return (
    <OverlayContext.Provider value={overlay}>
      <PressGroupContext.Provider value={group}>
      {phone ? (
        <Sheet
          open={open}
          onClose={dismiss}
          title={title}
          sub={sub}
          full={full || side}
          footer={foot}
          dismissible={dismissible}
          blur={blur}
          role={role ?? "dialog"}
          container={container}
          bodyClassName={bodyClassName}
        >
          {body}
        </Sheet>
      ) : (
        <Dialog.Root open={open} onOpenChange={(next) => !next && dismiss()}>
          <Dialog.Portal container={container ?? undefined}>
            <Dialog.Overlay
              data-blur={blur || undefined}
              className={cn(
                "fixed inset-0 z-50 grid bg-scrim",
                blur && "backdrop-blur-md",
                side ? "justify-items-end" : "place-items-center overflow-y-auto p-5",
              )}
            >
              <Dialog.Content
                ref={box}
                role={role ?? "dialog"}
                data-ui="modal"
                aria-modal="true"
                {...(sub ? {} : { "aria-describedby": undefined })}
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  focusInto(box.current, false);
                }}
                onCloseAutoFocus={returnFocus}
                onEscapeKeyDown={(e) => (!dismissible || escapeClosesList(e)) && e.preventDefault()}
                onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
                className={cn(
                  "flex w-full flex-col bg-card text-card-foreground shadow-3 outline-none",
                  side
                    ? cn("h-full border-l border-border", SIDE_WIDTH[width])
                    : cn("max-h-full animate-rise rounded-sheet border border-border", WIDTH[width]),
                )}
              >
                <Chrome title={title} sub={sub} footer={foot} bodyClassName={bodyClassName}>
                  {body}
                </Chrome>
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      </PressGroupContext.Provider>
      {asking && (
        <Modal
          open
          onClose={() => setAsking(false)}
          title="Discard Changes"
          size="sm"
          role="alertdialog"
          container={container}
          footer={
            <>
              <Button data-autofocus onClick={() => setAsking(false)}>
                Keep Editing
              </Button>
              <Button variant="danger" onClick={discard}>
                Discard Changes
              </Button>
            </>
          }
        />
      )}
    </OverlayContext.Provider>
  );
}

export interface ModalFooterProps {
  /** Buttons only: Cancel first, the primary last (it lands full width at the bottom on a phone). */
  children: ReactNode;
}

/**
 * Renders its buttons in the footer of the modal, side panel or sheet around
 * it, so a form in the body keeps its state while its buttons stay at the
 * bottom (in thumb reach on a phone). A submit button outside the <form>
 * element names it with `form="<form id>"`. Outside an overlay it draws the
 * same footer row in place.
 */
export function ModalFooter({ children }: ModalFooterProps) {
  const slot = useContext(FooterContext);
  if (slot.inFooter) return <>{children}</>;
  if (!slot.inOverlay) {
    return (
      <div data-ui="modal-footer" className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3 phone:flex-col phone:items-stretch">
        <FooterContext.Provider value={IN_FOOTER}>
          <ActionGroup>{children}</ActionGroup>
        </FooterContext.Provider>
      </div>
    );
  }
  return slot.target ? createPortal(<FooterContext.Provider value={IN_FOOTER}>{children}</FooterContext.Provider>, slot.target) : null;
}

export interface GrowProps {
  /** Extra classes. */
  className?: string;
}

/** A spacer in a row of buttons: what precedes it stays left, what follows goes right. In a phone footer it folds away. */
export function Grow({ className }: GrowProps) {
  const { inFooter } = useContext(FooterContext);
  return <span aria-hidden="true" className={cn("mr-auto", inFooter && "phone:hidden", className)} />;
}

/* ------------------------------------------------------------------ *
 * useModal: one modal for the whole app, opened from anywhere
 * ------------------------------------------------------------------ */

/** What useModal().open takes. */
export interface ModalSpec {
  /** The title, at most 4 words. */
  title: ReactNode;
  /** A line under the title, desktop only. */
  sub?: ReactNode;
  /** The body, or a function of `close`. */
  body: ModalContent;
  /** Footer buttons, or a function of `close`. */
  footer?: ModalContent;
  /** The wider desktop dialog. */
  wide?: boolean;
  /** A full-screen sheet on a phone. */
  full?: boolean;
  /** A side panel on desktop. */
  side?: boolean;
  /** Unsaved changes from the start (forms usually say so with useUnsavedChanges instead). */
  dirty?: boolean;
  /** false: Esc, the scrim and a drag do nothing; the close button and the footer still close it (a prompt that must be answered). */
  dismissible?: boolean;
  /** Blur the screen behind the scrim (a prompt that must be answered before anything else). */
  blur?: boolean;
  /** Called once the modal closes, however it closed. */
  onClose?: () => void;
}

/** What useModal returns. */
export interface ModalApi {
  /** Open a modal; one already open is replaced, never stacked. */
  open: (spec: ModalSpec) => void;
  /** Close it now (after saving). Dismissals by the person go through the unsaved-changes check instead. */
  close: () => void;
  /** Whether one is open. */
  isOpen: boolean;
}

const ModalContext = createContext<ModalApi | null>(null);

export interface ModalProviderProps {
  /** The app. */
  children: ReactNode;
  /** Whatever is open closes when this changes: the app passes its route, so a new screen never inherits a dialog. */
  resetKey?: unknown;
  /** Where the modals mount; document.body by default. */
  container?: HTMLElement | null;
}

interface Current {
  spec: ModalSpec;
  open: boolean;
  key: number;
}

/** Hosts the app's one modal (useModal) and the confirmation layer above it (useConfirm). Wraps the app once. */
export function ModalProvider({ children, resetKey, container }: ModalProviderProps) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [layer, setLayer] = useState<(HostLayer & { open: boolean }) | null>(null);
  const spec = useRef<ModalSpec | null>(null);
  const top = useRef<HostLayer | null>(null);
  const counter = useRef(0);

  const close = useCallback(() => {
    const was = spec.current;
    if (!was) return;
    spec.current = null;
    setCurrent((c) => (c ? { ...c, open: false } : c));
    was.onClose?.();
  }, []);

  const open = useCallback((next: ModalSpec) => {
    spec.current = next;
    counter.current += 1;
    setCurrent({ spec: next, open: true, key: counter.current });
  }, []);

  const host = useMemo(
    () => ({
      show: (next: HostLayer) => {
        const was = top.current;
        top.current = next;
        setLayer({ ...next, open: true });
        was?.onDrop?.();
      },
      hide: () => {
        top.current = null;
        setLayer((l) => (l ? { ...l, open: false } : l));
      },
    }),
    [],
  );

  // A new screen closes whatever was open on the last one, and drops an unanswered confirmation.
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (Object.is(lastKey.current, resetKey)) return;
    lastKey.current = resetKey;
    spec.current = null;
    setCurrent(null);
    const was = top.current;
    top.current = null;
    setLayer(null);
    was?.onDrop?.();
  }, [resetKey]);

  // An unanswered confirmation never outlives the provider.
  useEffect(
    () => () => {
      const was = top.current;
      top.current = null;
      was?.onDrop?.();
    },
    [],
  );

  const api = useMemo<ModalApi>(() => ({ open, close, isOpen: !!current?.open }), [open, close, current?.open]);

  return (
    <ModalContext.Provider value={api}>
      <HostContext.Provider value={host}>
        {children}
        {current && (
          <Modal
            open={current.open}
            onClose={close}
            title={current.spec.title}
            sub={current.spec.sub}
            wide={current.spec.wide}
            full={current.spec.full}
            side={current.spec.side}
            dirty={current.spec.dirty}
            dismissible={current.spec.dismissible}
            blur={current.spec.blur}
            container={container}
            footer={current.spec.footer}
          >
            {(c) => <Fragment key={current.key}>{render(current.spec.body, c)}</Fragment>}
          </Modal>
        )}
        {layer?.render(layer.open)}
      </HostContext.Provider>
    </ModalContext.Provider>
  );
}

/** The app's one modal: `useModal().open({ title, body })`. Needs ModalProvider around the app. */
export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal needs ModalProvider around the app");
  return ctx;
}
