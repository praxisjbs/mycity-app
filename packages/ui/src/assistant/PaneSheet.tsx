/**
 * @component PaneSheet
 * @group Assistant
 * @summary The phone's pane: a full-height sheet that holds the four views (PaneTabs) for one answer, opened from Open Figures under it.
 * @use On a phone, around PaneTabs, opened by an AnswerBubble's Open Figures; desktop shows the pane beside the conversation instead (AssistantShell).
 * @avoid Desktop (AssistantShell's `pane`); a record's own sheet (ListDetail); a short choice (Sheet).
 * @phone This is its phone form: the whole height, dragged down, Back or Esc to close; the phone's own Back closes it first (F29).
 * @a11y A modal dialog named Figures (Sheet underneath): focus moves in and is trapped, Esc and Back close it, focus returns to Open Figures.
 * @status beta
 * @example <PaneSheet open={open} onClose={close}><PaneTabs value={tab} onValueChange={setTab} table={table} sources={sources} /></PaneSheet>
 */
import type { ReactNode } from "react";
import { Sheet } from "../overlay/Sheet";

export interface PaneSheetProps {
  /** Whether the sheet is showing. */
  open: boolean;
  /** Called when the person closes it (drag down, scrim, Esc, the close button, the phone's Back). */
  onClose: () => void;
  /** The heading, at most 4 words; Figures unless set. */
  title?: ReactNode;
  /** The PaneTabs. */
  children: ReactNode;
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

export function PaneSheet({ open, onClose, title = "Figures", children, container }: PaneSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title} full container={container} bodyClassName="flex flex-col p-0">
      {children}
    </Sheet>
  );
}
