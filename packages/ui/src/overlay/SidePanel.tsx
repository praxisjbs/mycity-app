/**
 * @component SidePanel
 * @group Overlays
 * @summary A panel that slides over the right of the screen to edit or inspect the record behind it.
 * @use Editing a record you are looking at on desktop (FRONTEND_GUIDE §8.1); a record's detail opened from a table row while the list stays in view.
 * @avoid A new record or a short form (use Modal); a page of its own (route to it); content that must stay open while working elsewhere (a pane in the page).
 * @phone A full-screen sheet with the main action full width at the bottom.
 * @a11y A modal dialog like Modal: focus moves in and is trapped, Esc closes, focus returns to the opener, and unsaved changes ask once before a dismissal discards them.
 * @status stable
 * @example <SidePanel open={!!row} onClose={() => setRow(null)} title="Edit Employee">{form}</SidePanel>
 */
import type { ReactNode } from "react";
import { Modal, type ModalContent } from "./Modal";

export interface SidePanelProps {
  /** Whether it is showing. */
  open: boolean;
  /** Called to close it, once any unsaved changes are discarded. */
  onClose: () => void;
  /** The title, at most 4 words, Title Case ("Edit Employee"). */
  title: ReactNode;
  /** A line under the title, at most 8 words, desktop only. */
  sub?: ReactNode;
  /** The body, or a function of `close`. */
  children?: ModalContent;
  /** Footer buttons only (Cancel, then the primary), or a function of `close`. */
  footer?: ModalContent;
  /** Desktop width: `md` (the default, 448 px) or `wide` (672 px) for a table or a document. */
  size?: "md" | "wide";
  /** Unsaved changes: a dismissal asks once to discard them. */
  dirty?: boolean;
  /** Where it mounts; document.body by default. */
  container?: HTMLElement | null;
}

export function SidePanel({ size = "md", ...rest }: SidePanelProps) {
  return <Modal {...rest} size={size} side />;
}
