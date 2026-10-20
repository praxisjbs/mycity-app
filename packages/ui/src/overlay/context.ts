/**
 * What the overlays share without importing one another: the unsaved-changes
 * flag a form raises, the footer slot a body portals its buttons into, the
 * layer ModalProvider keeps for a confirmation over an open modal, and the
 * opener focus returns to on close.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/** The overlay around a component: a modal, side panel or sheet. */
export interface OverlayState {
  /** Raise or lower the unsaved-changes flag; the overlay asks once before a dismissal discards them. */
  setDirty: (dirty: boolean) => void;
  /** Close the way Esc does: asks to discard when there are unsaved changes. */
  dismiss: () => void;
}

export const OverlayContext = createContext<OverlayState | null>(null);

/**
 * Tells the modal, side panel or sheet around a form that it has unsaved
 * changes, so Esc, the close button, the scrim or a drag down asks once
 * whether to discard them. The form system calls it with its dirty state.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const overlay = useContext(OverlayContext);
  useEffect(() => {
    if (!overlay) return;
    overlay.setDirty(dirty);
    return () => overlay.setDirty(false);
  }, [overlay, dirty]);
}

/**
 * Closes the overlay around this component the way Esc does (asking to discard
 * unsaved changes first). A form's Cancel button uses it. Outside an overlay it
 * does nothing.
 */
export function useDismiss(): () => void {
  const overlay = useContext(OverlayContext);
  return useCallback(() => overlay?.dismiss(), [overlay]);
}

/** Where a footer renders: inside an overlay, its footer element, and whether we are already inside it. */
export interface FooterSlot {
  inOverlay: boolean;
  target: HTMLElement | null;
  inFooter: boolean;
}

export const FooterContext = createContext<FooterSlot>({ inOverlay: false, target: null, inFooter: false });

/** The slot for content already rendered in a footer. */
export const IN_FOOTER: FooterSlot = { inOverlay: true, target: null, inFooter: true };

/** One layer above the modal (a confirmation). `render` gets whether it is open, so it can animate out. */
export interface HostLayer {
  render: (open: boolean) => ReactNode;
  /** Called when the layer is dropped without an answer: replaced, reset by a route change, or unmounted. */
  onDrop?: () => void;
}

export interface Host {
  show: (layer: HostLayer) => void;
  hide: () => void;
}

export const HostContext = createContext<Host | null>(null);

/**
 * Remembers what had focus when an overlay opened and returns focus there on
 * close, even when the overlay was opened from state (a row, a menu item)
 * rather than a trigger. Pass the result as `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean): (e: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && !opener.current) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
  }, [open]);
  return useCallback((e: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus();
    }
  }, []);
}

/** Fields that take typing, so the phone's keyboard comes up when one has focus. */
/**
 * Esc pressed in a field whose own list is open (an AddressField's suggestions)
 * closes that list, not the overlay around it. The dialog hears Esc first, on the
 * document, so it is the one that has to step aside.
 */
export const escapeClosesList = (e: KeyboardEvent): boolean => {
  const t = e.target;
  return t instanceof HTMLElement && t.getAttribute("role") === "combobox" && t.getAttribute("aria-expanded") === "true";
};

export const TEXT_ENTRY = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]";

/**
 * Moves focus into an overlay as it opens. Desktop: the element marked
 * `data-autofocus`, else the first field, else the overlay itself. Phone: the
 * overlay itself (no keyboard springing up), unless `data-autofocus` marks
 * something that is not a text field.
 */
export function focusInto(root: HTMLElement | null, phone: boolean): void {
  if (!root) return;
  const marked = root.querySelector<HTMLElement>("[data-autofocus]");
  if (phone) {
    (marked && !marked.matches(TEXT_ENTRY) ? marked : root).focus();
    return;
  }
  (marked ?? root.querySelector<HTMLElement>(TEXT_ENTRY) ?? root).focus();
}
